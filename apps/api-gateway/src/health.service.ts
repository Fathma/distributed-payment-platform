import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '@payflow/config';
import { MetricsService, PAYFLOW_METRICS } from '@payflow/metrics';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis = new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

  constructor(@Inject(PAYFLOW_METRICS) private readonly metrics: MetricsService) {}

  async check() {
    const startedAt = process.hrtime.bigint();
    try {
      await this.redis.ping();
      this.metrics.recordDependency('redis', 'ok', Number(process.hrtime.bigint() - startedAt) / 1e9);
      return { status: 'ready', dependencies: { redis: 'ok' } };
    } catch {
      this.metrics.recordDependency('redis', 'failure', Number(process.hrtime.bigint() - startedAt) / 1e9);
      return { status: 'not_ready', dependencies: { redis: 'unavailable' } };
    }
  }

  onModuleDestroy() { this.redis.disconnect(); }
}
