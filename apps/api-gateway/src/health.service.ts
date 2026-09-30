import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '@payflow/config';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis = new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

  async check() {
    try {
      await this.redis.ping();
      return { status: 'ready', dependencies: { redis: 'ok' } };
    } catch {
      return { status: 'not_ready', dependencies: { redis: 'unavailable' } };
    }
  }

  onModuleDestroy() { this.redis.disconnect(); }
}
