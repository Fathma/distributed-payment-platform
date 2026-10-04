import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { Pool, type PoolClient } from 'pg';
import { createEventEnvelope, type EventEnvelope, type PaymentRequestedData, type PaymentResultData } from '@payflow/shared-types';
import { loadConfig } from '@payflow/config';
import { log } from '@payflow/logger';
import { MockPaymentProvider, ProviderError } from './mock-payment-provider';
import { isRetryableProviderFailure, retryDelayMs } from './retry-policy';
import { MetricsService, PAYFLOW_METRICS } from '@payflow/metrics';

const MAX_ATTEMPTS = Number(process.env.PAYMENT_MAX_ATTEMPTS ?? '4');
const BASE_RETRY_MS = Number(process.env.PAYMENT_RETRY_BASE_MS ?? '1000');
const MAX_RETRY_MS = Number(process.env.PAYMENT_RETRY_MAX_MS ?? '30000');
interface JobRow { event_id: string; payment_id: string; original_event: EventEnvelope<'payment.requested', PaymentRequestedData>; attempt_count: number }

@Injectable()
export class PaymentConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly config = loadConfig();
  private readonly pool = new Pool({ connectionString: this.config.workerDatabaseUrl });
  private readonly kafka = new Kafka({ clientId: 'payment-worker', brokers: this.config.kafkaBrokers });
  private readonly consumer: Consumer = this.kafka.consumer({ groupId: 'payment-worker-v1' });
  private readonly producer: Producer = this.kafka.producer();
  private pollTimer?: NodeJS.Timeout;
  private working = false;

  constructor(private readonly provider: MockPaymentProvider, @Inject(PAYFLOW_METRICS) private readonly metrics: MetricsService) {
    this.consumer.on(this.consumer.events.START_BATCH_PROCESS, ({ payload }) => {
      this.metrics.setConsumerLag('payment-worker-v1', payload.topic, payload.partition, Number(payload.offsetLag));
    });
  }

  async onModuleInit() {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'payment.requested', fromBeginning: true });
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;
        const startedAt = process.hrtime.bigint();
        try {
          const event = JSON.parse(message.value.toString()) as EventEnvelope<'payment.requested', PaymentRequestedData>;
          await this.pool.query(
            `INSERT INTO worker_jobs (event_id, payment_id, original_event) VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (event_id) DO NOTHING`, [event.eventId, event.data.paymentId, JSON.stringify(event)],
          );
          await this.consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
          this.metrics.recordKafkaMessage(topic, 'success', Number(process.hrtime.bigint() - startedAt) / 1e9);
        } catch (error) {
          this.metrics.recordKafkaMessage(topic, 'failure', Number(process.hrtime.bigint() - startedAt) / 1e9);
          throw error;
        }
      },
    });
    this.pollTimer = setInterval(() => void this.processNext().catch((error: unknown) => log('error', 'Payment job processing failed', { service: 'payment-worker', error: String(error) })), 250);
    this.pollTimer.unref();
  }

  private async processNext() {
    if (this.working) return;
    this.working = true;
    let client: PoolClient | undefined;
    try {
      let job: JobRow | undefined;
      client = await this.pool.connect();
      await client.query('BEGIN');
      const result = await client.query<JobRow>(
        `SELECT event_id, payment_id, original_event, attempt_count FROM worker_jobs
         WHERE completed_at IS NULL AND available_at <= now() AND (locked_until IS NULL OR locked_until < now())
         ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      job = result.rows[0];
      if (!job) { await client.query('COMMIT'); return; }
      await client.query("UPDATE worker_jobs SET locked_until = now() + interval '2 minutes' WHERE event_id = $1", [job.event_id]);
      await client.query('COMMIT');
      client.release();
      client = undefined;
      await this.process(job);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client?.release();
      this.working = false;
    }
  }

  private async process(job: JobRow) {
    const startedAt = process.hrtime.bigint();
    const event = job.original_event;
    const { paymentId, orderId, amount, currency, providerIdempotencyKey, processingGeneration } = event.data;
    const attempt = job.attempt_count + 1;
    try {
      const result = await this.provider.charge({ idempotencyKey: providerIdempotencyKey, paymentId, amount, currency });
      const data: PaymentResultData = { paymentId, orderId, providerReference: result.providerReference, attemptCount: attempt, failureCode: null, failureMessage: null, processingGeneration };
      await this.publishResult(event, 'payment.completed', data);
      await this.finish(job.event_id);
      this.metrics.recordPaymentOutcome('success');
      this.metrics.recordPaymentProcessing('success', Number(process.hrtime.bigint() - startedAt) / 1e9);
      log('info', 'Mock provider approved payment', { service: 'payment-worker', requestId: event.requestId, correlationId: event.correlationId, paymentId, attempt });
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'PROVIDER_ERROR';
      const message = error instanceof Error ? error.message : 'Unknown provider error';
      const retryable = isRetryableProviderFailure(code);
      if (retryable && attempt < MAX_ATTEMPTS) {
        const delay = retryDelayMs(attempt, BASE_RETRY_MS, MAX_RETRY_MS);
        await this.pool.query(
          'UPDATE worker_jobs SET attempt_count = $2, available_at = now() + ($3 * interval \'1 millisecond\'), locked_until = NULL WHERE event_id = $1',
          [job.event_id, attempt, delay],
        );
        log('warn', 'Payment provider attempt will be retried', { service: 'payment-worker', paymentId, attempt, maxAttempts: MAX_ATTEMPTS, retryDelayMs: delay, failureCode: code });
        this.metrics.recordRetry(code);
        return;
      }

      const data: PaymentResultData = { paymentId, orderId, providerReference: null, attemptCount: attempt, failureCode: code, failureMessage: message, processingGeneration };
      const dlqId = await this.storeDlq(job, data);
      await this.producer.send({ topic: 'payment.dlq', messages: [{ key: paymentId, value: JSON.stringify({ dlqId, originalMessage: event, error: message, attempts: attempt, failedAt: new Date().toISOString(), service: 'payment-worker', correlationId: event.correlationId }) }] });
      await this.publishResult(event, 'payment.failed', data);
      await this.finish(job.event_id);
      this.metrics.recordPaymentOutcome('failure');
      this.metrics.recordPaymentProcessing('failure', Number(process.hrtime.bigint() - startedAt) / 1e9);
      this.metrics.recordDlq('created');
    }
  }

  private async publishResult(event: EventEnvelope<'payment.requested', PaymentRequestedData>, eventType: 'payment.completed' | 'payment.failed', data: PaymentResultData) {
    const result = createEventEnvelope({ eventType, producer: 'payment-worker', aggregateId: data.paymentId, data, requestId: event.requestId, correlationId: event.correlationId });
    await this.producer.send({ topic: eventType, messages: [{ key: data.paymentId, value: JSON.stringify(result) }] });
  }

  private async finish(eventId: string) {
    await this.pool.query('UPDATE worker_jobs SET completed_at = now(), locked_until = NULL WHERE event_id = $1', [eventId]);
  }

  private async storeDlq(job: JobRow, data: PaymentResultData) {
    const result = await this.pool.query<{ dlq_id: string }>(
      `INSERT INTO worker_dlq (dlq_id, event_id, payment_id, original_event, error, attempts)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (event_id) DO NOTHING RETURNING dlq_id`,
      [randomUUID(), job.event_id, job.payment_id, JSON.stringify(job.original_event), data.failureMessage ?? data.failureCode, data.attemptCount],
    );
    if (result.rowCount) return result.rows[0].dlq_id;
    const existing = await this.pool.query<{ dlq_id: string }>('SELECT dlq_id FROM worker_dlq WHERE event_id = $1', [job.event_id]);
    return existing.rows[0].dlq_id;
  }

  async listDlq() {
    const result = await this.pool.query('SELECT dlq_id, payment_id, original_event, error, attempts, failed_at FROM worker_dlq WHERE reprocessed_at IS NULL ORDER BY failed_at DESC LIMIT 100');
    return result.rows;
  }

  async reprocess(dlqId: string, adminId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ event_id: string; payment_id: string; original_event: object }>(
        'SELECT event_id, payment_id, original_event FROM worker_dlq WHERE dlq_id = $1 AND reprocessed_at IS NULL FOR UPDATE', [dlqId],
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return false; }
      const row = result.rows[0];
      const event = row.original_event as EventEnvelope<'payment.requested', PaymentRequestedData>;
      const replay = { ...event, eventId: randomUUID(), occurredAt: new Date().toISOString() };
      await client.query('INSERT INTO worker_jobs (event_id, payment_id, original_event) VALUES ($1, $2, $3::jsonb)', [replay.eventId, row.payment_id, JSON.stringify(replay)]);
      await client.query('UPDATE worker_dlq SET reprocessed_at = now(), reprocessed_by = $2 WHERE dlq_id = $1', [dlqId, adminId]);
      await client.query('COMMIT');
      this.metrics.recordDlq('reprocessed');
      return true;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.consumer.disconnect().catch(() => undefined);
    await this.producer.disconnect().catch(() => undefined);
    await this.pool.end();
  }
}
