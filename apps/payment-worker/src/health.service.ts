import { Injectable } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { loadConfig } from '@payflow/config';
import { Pool } from 'pg';

@Injectable()
export class HealthService {
  private readonly pool = new Pool({ connectionString: loadConfig().workerDatabaseUrl, connectionTimeoutMillis: 1500, max: 1 });
  private readonly kafka = new Kafka({ clientId: 'payment-worker-health', brokers: loadConfig().kafkaBrokers, connectionTimeout: 1500, requestTimeout: 2000, retry: { retries: 0 } });

  async check() {
    const dependencies: Record<string, 'ok' | 'unavailable'> = { kafka: 'unavailable', postgres: 'unavailable' };
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin.describeCluster();
      dependencies.kafka = 'ok';
    } catch {
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
    try { await this.pool.query('SELECT 1'); dependencies.postgres = 'ok'; } catch { /* report below */ }
    const ready = Object.values(dependencies).every((status) => status === 'ok');
    return { status: ready ? 'ready' : 'not_ready', dependencies };
  }

  async onModuleDestroy() { await this.pool.end(); }
}
