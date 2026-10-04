import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { loadConfig } from '@payflow/config';
import { Pool } from 'pg';
import { MetricsService, PAYFLOW_METRICS } from '@payflow/metrics';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: loadConfig().workerDatabaseUrl, connectionTimeoutMillis: 1500, max: 1 });
  private readonly kafka = new Kafka({ clientId: 'payment-worker-health', brokers: loadConfig().kafkaBrokers, connectionTimeout: 1500, requestTimeout: 2000, retry: { retries: 0 } });

  constructor(@Inject(PAYFLOW_METRICS) private readonly metrics: MetricsService) {}

  async check() {
    const dependencies: Record<string, 'ok' | 'unavailable'> = { kafka: 'unavailable', postgres: 'unavailable' };
    const admin = this.kafka.admin();
    let startedAt = process.hrtime.bigint();
    try {
      await admin.connect();
      await admin.describeCluster();
      dependencies.kafka = 'ok';
    } catch {
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
    this.metrics.recordDependency('kafka', dependencies.kafka === 'ok' ? 'ok' : 'failure', Number(process.hrtime.bigint() - startedAt) / 1e9);
    startedAt = process.hrtime.bigint();
    try { await this.pool.query('SELECT 1'); dependencies.postgres = 'ok'; } catch { /* report below */ }
    this.metrics.recordDependency('postgres', dependencies.postgres === 'ok' ? 'ok' : 'failure', Number(process.hrtime.bigint() - startedAt) / 1e9);
    const ready = Object.values(dependencies).every((status) => status === 'ok');
    return { status: ready ? 'ready' : 'not_ready', dependencies };
  }

  async onModuleDestroy() { await this.pool.end(); }
}
