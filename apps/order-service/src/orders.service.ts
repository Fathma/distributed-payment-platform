import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { Pool, type PoolClient } from 'pg';
import { createEventEnvelope, type EventEnvelope, type OrderCreatedData, type PaymentRequestedData, type PaymentResultData } from '@payflow/shared-types';
import { loadConfig } from '@payflow/config';
import { log } from '@payflow/logger';
import type { CreateOrderRequest } from './orders.controller';
import { assertIdempotencyRequestMatches, hashOrderRequest, normalizeOrder } from './order-policy';
import { MetricsService, PAYFLOW_METRICS } from '@payflow/metrics';

interface OrderRow {
  id: string;
  user_id: string;
  items: CreateOrderRequest['items'];
  total_amount: string;
  currency: string;
  status: string;
  payment_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface OutboxRow { event_id: string; aggregate_id: string; event_type: string; payload: EventEnvelope<string, unknown> }

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: loadConfig().orderDatabaseUrl });
  private readonly kafka = new Kafka({ clientId: 'order-service', brokers: loadConfig().kafkaBrokers });
  private readonly producer: Producer = this.kafka.producer();
  private readonly consumer: Consumer = this.kafka.consumer({ groupId: 'order-service-v1' });
  private outboxTimer?: NodeJS.Timeout;

  constructor(@Inject(PAYFLOW_METRICS) private readonly metrics: MetricsService) {
    this.pool.on('error', (error) => log('error', 'Idle order database connection failed', { service: 'order-service', error: error.message }));
    this.consumer.on(this.consumer.events.START_BATCH_PROCESS, ({ payload }) => {
      this.metrics.setConsumerLag('order-service-v1', payload.topic, payload.partition, Number(payload.offsetLag));
    });
  }

  async onModuleInit() {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: ['payment.requested', 'payment.succeeded', 'payment.declined'], fromBeginning: true });
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;
        const startedAt = process.hrtime.bigint();
        try {
          const event = JSON.parse(message.value.toString()) as EventEnvelope<string, PaymentRequestedData | PaymentResultData>;
          await this.applyPaymentEvent(event);
          await this.consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
          this.metrics.recordKafkaMessage(topic, 'success', Number(process.hrtime.bigint() - startedAt) / 1e9);
        } catch (error) {
          this.metrics.recordKafkaMessage(topic, 'failure', Number(process.hrtime.bigint() - startedAt) / 1e9);
          throw error;
        }
      },
    });
    this.outboxTimer = setInterval(() => void this.publishOutbox().catch((error: unknown) => log('error', 'Order outbox publish failed', { service: 'order-service', error: String(error) })), 500);
    this.outboxTimer.unref();
  }

  async create(input: CreateOrderRequest, idempotencyKey: string, userId: string, requestId?: string, correlationId?: string) {
    const { items, currency, totalAmount } = normalizeOrder(input);
    const requestHash = hashOrderRequest(items, currency);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query<{ request_hash: string; response: ReturnType<OrdersService['toOrder']> }>(
        'SELECT request_hash, response FROM order_idempotency_keys WHERE user_id = $1 AND key = $2 AND expires_at > now()',
        [userId, idempotencyKey],
      );
      if (previous.rowCount) {
        assertIdempotencyRequestMatches(previous.rows[0].request_hash, requestHash);
        await client.query('COMMIT');
        return previous.rows[0].response;
      }

      const orderId = `ord_${randomUUID()}`;
      const event = createEventEnvelope({
        eventType: 'order.created', producer: 'order-service', aggregateId: orderId,
        data: { orderId, userId, amount: totalAmount, currency, idempotencyKey }, requestId, correlationId,
      });
      await client.query(
        `INSERT INTO orders (id, user_id, items, total_amount, currency, status)
         VALUES ($1, $2, $3::jsonb, $4, $5, 'PENDING_PAYMENT')`,
        [orderId, userId, JSON.stringify(items), totalAmount, currency],
      );
      await client.query(
        `INSERT INTO order_outbox (event_id, aggregate_id, event_type, schema_version, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [event.eventId, orderId, event.eventType, event.schemaVersion, JSON.stringify(event)],
      );
      const created = await this.getOrderRow(client, orderId, userId);
      const response = this.toOrder(created);
      await client.query(
        `INSERT INTO order_idempotency_keys (user_id, key, request_hash, order_id, response, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now() + interval '24 hours')`,
        [userId, idempotencyKey, requestHash, orderId, JSON.stringify(response)],
      );
      await client.query('COMMIT');
      log('info', 'Order created', { service: 'order-service', requestId: event.requestId, correlationId: event.correlationId, orderId });
      return response;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async get(id: string, userId: string) {
    const result = await this.pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!result.rowCount) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order was not found' });
    return this.toOrder(result.rows[0]);
  }

  async list(userId: string, requestedLimit?: string) {
    const parsed = requestedLimit === undefined ? 20 : Number(requestedLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new BadRequestException('limit must be an integer from 1 to 100');
    const result = await this.pool.query<OrderRow>('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, parsed]);
    return result.rows.map((row) => this.toOrder(row));
  }

  private async getOrderRow(client: PoolClient, id: string, userId: string) {
    const result = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!result.rowCount) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order was not found' });
    return result.rows[0];
  }

  private toOrder(row: OrderRow) {
    return {
      id: row.id, userId: row.user_id, items: row.items, totalAmount: Number(row.total_amount), currency: row.currency.trim(),
      status: row.status, paymentId: row.payment_id, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private async applyPaymentEvent(event: EventEnvelope<string, PaymentRequestedData | PaymentResultData>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO order_inbox (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.eventId]);
      if (inserted.rowCount) {
        const data = event.data;
        if (event.eventType === 'payment.requested') {
          await client.query(
            `UPDATE orders SET payment_id = $1, status = 'PAYMENT_PROCESSING', updated_at = now()
             WHERE id = $2 AND status = 'PENDING_PAYMENT'`, [data.paymentId, data.orderId],
          );
        } else if (event.eventType === 'payment.succeeded' || event.eventType === 'payment.declined') {
          const status = event.eventType === 'payment.succeeded' ? 'PAID' : 'PAYMENT_FAILED';
          await client.query(
            `UPDATE orders SET payment_id = $1, status = $2, updated_at = now()
             WHERE id = $3 AND status <> 'CANCELLED'`, [data.paymentId, status, data.orderId],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async publishOutbox() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query<OutboxRow>(
        `SELECT event_id, aggregate_id, event_type, payload FROM order_outbox
         WHERE published_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );
      for (const row of rows.rows) {
        await this.producer.send({ topic: row.event_type, messages: [{ key: row.aggregate_id, value: JSON.stringify(row.payload) }] });
        await client.query('UPDATE order_outbox SET published_at = now() WHERE event_id = $1', [row.event_id]);
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
