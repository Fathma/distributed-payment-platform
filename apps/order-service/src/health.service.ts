import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import { loadConfig } from '@payflow/config';
import { log } from '@payflow/logger';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly config = loadConfig();
  private readonly pool = new Pool({ connectionString: this.config.orderDatabaseUrl, connectionTimeoutMillis: 1500, max: 1 });
  private readonly kafka = new Kafka({ clientId: 'order-service-health', brokers: this.config.kafkaBrokers, connectionTimeout: 1500, requestTimeout: 2000, retry: { retries: 0 } });

  constructor() { this.pool.on('error', (error) => log('error', 'Idle order database connection failed', { service: 'order-service', error: error.message })); }

  async check() {
    const dependencies: Record<string, 'ok' | 'unavailable'> = { postgres: 'unavailable', kafka: 'unavailable' };
    try { await this.pool.query('SELECT 1'); dependencies.postgres = 'ok'; } catch { /* report below */ }
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin.describeCluster();
      dependencies.kafka = 'ok';
    } catch { /* report below */ }
    finally { await admin.disconnect().catch(() => undefined); }
    const ready = Object.values(dependencies).every((status) => status === 'ok');
    return { status: ready ? 'ready' : 'not_ready', dependencies };
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
