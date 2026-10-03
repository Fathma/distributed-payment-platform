import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, type Consumer, type Producer } from 'kafkajs';
import { createEventEnvelope, type EventEnvelope, type PaymentRequestedData, type PaymentResultData } from '@payflow/shared-types';
import { loadConfig } from '@payflow/config';
import { log } from '@payflow/logger';
import { MockPaymentProvider, ProviderError } from './mock-payment-provider';

@Injectable()
export class PaymentConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka = new Kafka({ clientId: 'payment-worker', brokers: loadConfig().kafkaBrokers });
  private readonly consumer: Consumer = this.kafka.consumer({ groupId: 'payment-worker-v1' });
  private readonly producer: Producer = this.kafka.producer();

  constructor(private readonly provider: MockPaymentProvider) {}

  async onModuleInit() {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'payment.requested', fromBeginning: true });
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;
        const event = JSON.parse(message.value.toString()) as EventEnvelope<'payment.requested', PaymentRequestedData>;
        await this.process(event);
        await this.consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
      },
    });
  }

  private async process(event: EventEnvelope<'payment.requested', PaymentRequestedData>) {
    const { paymentId, orderId, amount, currency, providerIdempotencyKey, processingGeneration } = event.data;
    let eventType: 'payment.completed' | 'payment.failed';
    let data: PaymentResultData;
    try {
      const result = await this.provider.charge({ idempotencyKey: providerIdempotencyKey, paymentId, amount, currency });
      eventType = 'payment.completed';
      data = {
        paymentId, orderId, providerReference: result.providerReference, attemptCount: 1,
        failureCode: null, failureMessage: null, processingGeneration,
      };
      log('info', 'Mock provider approved payment', { service: 'payment-worker', requestId: event.requestId, correlationId: event.correlationId, paymentId });
    } catch (error) {
      eventType = 'payment.failed';
      data = {
        paymentId, orderId, providerReference: null, attemptCount: 1,
        failureCode: error instanceof ProviderError ? error.code : 'PROVIDER_ERROR',
        failureMessage: error instanceof Error ? error.message : 'Unknown provider error', processingGeneration,
      };
      log('warn', 'Mock provider rejected payment attempt', { service: 'payment-worker', requestId: event.requestId, correlationId: event.correlationId, paymentId, failureCode: data.failureCode });
    }

    const resultEvent = createEventEnvelope({
      eventType, producer: 'payment-worker', aggregateId: paymentId, data,
      requestId: event.requestId, correlationId: event.correlationId,
    });
    await this.producer.send({ topic: eventType, messages: [{ key: paymentId, value: JSON.stringify(resultEvent) }] });
  }

  async onModuleDestroy() {
    await this.consumer.disconnect().catch(() => undefined);
    await this.producer.disconnect().catch(() => undefined);
  }
}
