import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { Pool, type PoolClient } from 'pg';
import { createEventEnvelope, type EventEnvelope, type OrderCreatedData, type PaymentRequestedData, type PaymentResultData } from '@payflow/shared-types';
import { loadConfig } from '@payflow/config';
import { log } from '@payflow/logger';

interface PaymentRow {
  id: string; order_id: string; user_id: string; amount: string; currency: string; status: string;
  provider_reference: string | null; attempt_count: number; created_at: Date; updated_at: Date;
}
interface OutboxRow { event_id: string; aggregate_id: string; event_type: string; payload: EventEnvelope<string, unknown> }

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly config = loadConfig();
  private readonly pool = new Pool({ connectionString: this.config.paymentDatabaseUrl });
  private readonly kafka = new Kafka({ clientId: 'payment-service', brokers: this.config.kafkaBrokers });
  private readonly producer: Producer = this.kafka.producer();
  private readonly consumer: Consumer = this.kafka.consumer({ groupId: 'payment-service-v1' });
  private outboxTimer?: NodeJS.Timeout;

  constructor() { this.pool.on('error', (error) => log('error', 'Idle payment database connection failed', { service: 'payment-service', error: error.message })); }

  async onModuleInit() {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: ['order.created', 'payment.completed', 'payment.failed'], fromBeginning: true });
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString()) as EventEnvelope<string, OrderCreatedData | PaymentResultData>;
        if (topic === 'order.created') await this.createFromOrder(event as EventEnvelope<string, OrderCreatedData>);
        else await this.recordProviderResult(event as EventEnvelope<string, PaymentResultData>);
        await this.consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
      },
    });
    this.outboxTimer = setInterval(() => void this.publishOutbox().catch((error: unknown) => log('error', 'Payment outbox publish failed', { service: 'payment-service', error: String(error) })), 500);
    this.outboxTimer.unref();
  }

  async get(id: string, userId: string) {
    const result = await this.pool.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      id: row.id, orderId: row.order_id, userId: row.user_id, amount: Number(row.amount), currency: row.currency.trim(),
      status: row.status, providerReference: row.provider_reference, attemptCount: row.attempt_count,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private async createFromOrder(event: EventEnvelope<string, OrderCreatedData>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO payment_inbox (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id`, [event.eventId],
      );
      if (!inserted.rowCount) { await client.query('COMMIT'); return; }
      const paymentId = `pay_${randomUUID()}`;
      const created = await client.query<{ id: string }>(
        `INSERT INTO payments (id, order_id, user_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING') ON CONFLICT (order_id) DO NOTHING RETURNING id`,
        [paymentId, event.data.orderId, event.data.userId, event.data.amount, event.data.currency],
      );
      if (created.rowCount) {
        const data: PaymentRequestedData = {
          paymentId, orderId: event.data.orderId, amount: event.data.amount, currency: event.data.currency,
          providerIdempotencyKey: paymentId, processingGeneration: 1,
        };
        const requested = createEventEnvelope({
          eventType: 'payment.requested', producer: 'payment-service', aggregateId: paymentId, data,
          requestId: event.requestId, correlationId: event.correlationId,
        });
        await this.insertOutbox(client, requested);
        log('info', 'Payment created', { service: 'payment-service', requestId: event.requestId, correlationId: event.correlationId, paymentId, orderId: event.data.orderId });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async recordProviderResult(event: EventEnvelope<string, PaymentResultData>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO payment_inbox (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.eventId]);
      if (inserted.rowCount) {
        const succeeded = event.eventType === 'payment.completed';
        const status = succeeded ? 'SUCCESS' : 'FAILED';
        const updated = await client.query(
          `UPDATE payments SET status = $1, provider_reference = $2, attempt_count = $3, updated_at = now()
           WHERE id = $4 AND order_id = $5`,
          [status, event.data.providerReference, event.data.attemptCount, event.data.paymentId, event.data.orderId],
        );
        if (!updated.rowCount) throw new Error(`Provider result references unknown payment ${event.data.paymentId}`);
        const normalized = createEventEnvelope({
          eventType: succeeded ? 'payment.succeeded' : 'payment.declined', producer: 'payment-service',
          aggregateId: event.data.paymentId,
          data: { paymentId: event.data.paymentId, orderId: event.data.orderId, status, providerReference: event.data.providerReference },
          requestId: event.requestId, correlationId: event.correlationId,
        });
        await this.insertOutbox(client, normalized);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async insertOutbox(client: PoolClient, event: EventEnvelope<string, unknown>) {
    await client.query(
      `INSERT INTO payment_outbox (event_id, aggregate_id, event_type, schema_version, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [event.eventId, event.aggregateId, event.eventType, event.schemaVersion, JSON.stringify(event)],
    );
  }

  private async publishOutbox() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query<OutboxRow>(
        `SELECT event_id, aggregate_id, event_type, payload FROM payment_outbox
         WHERE published_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );
      for (const row of rows.rows) {
        await this.producer.send({ topic: row.event_type, messages: [{ key: row.aggregate_id, value: JSON.stringify(row.payload) }] });
        await client.query('UPDATE payment_outbox SET published_at = now() WHERE event_id = $1', [row.event_id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async onModuleDestroy() {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    await this.consumer.disconnect().catch(() => undefined);
    await this.producer.disconnect().catch(() => undefined);
    await this.pool.end();
  }
}
