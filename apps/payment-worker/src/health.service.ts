import { Injectable } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { loadConfig } from '@payflow/config';

@Injectable()
export class HealthService {
  private readonly kafka = new Kafka({ clientId: 'payment-worker-health', brokers: loadConfig().kafkaBrokers, connectionTimeout: 1500, requestTimeout: 2000, retry: { retries: 0 } });

  async check() {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin.describeCluster();
      return { status: 'ready', dependencies: { kafka: 'ok' } };
    } catch {
      return { status: 'not_ready', dependencies: { kafka: 'unavailable' } };
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }
}
