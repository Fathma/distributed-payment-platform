import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '@payflow/config';
import { log } from '@payflow/logger';
import { MetricsService, PAYFLOW_METRICS } from '@payflow/metrics';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client = new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500 });

  constructor(@Inject(PAYFLOW_METRICS) private readonly metrics: MetricsService) {
    this.client.on('error', (error) => log('warn', 'Gateway Redis request failed', { service: 'api-gateway', error: error.message }));
  }

  async consumeFixedWindow(key: string): Promise<[number, number]> {
    const result = await this.observe(this.client.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return {count, redis.call('TTL', KEYS[1])}",
      1, key, 60,
    ) as Promise<[number, number]>);
    return [Number(result[0]), Number(result[1])];
  }

  get(key: string) { return this.observe(this.client.get(key)); }
  set(key: string, value: string, seconds: number) { return this.observe(this.client.set(key, value, 'EX', seconds)); }
  del(...keys: string[]) { return keys.length ? this.observe(this.client.del(...keys)) : Promise.resolve(0); }
  smembers(key: string) { return this.observe(this.client.smembers(key)); }
  sadd(key: string, member: string) { return this.observe(this.client.sadd(key, member)); }
  expire(key: string, seconds: number) { return this.observe(this.client.expire(key, seconds)); }

  private async observe<T>(operation: Promise<T>): Promise<T> {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await operation;
      this.metrics.recordDependency('redis', 'ok', Number(process.hrtime.bigint() - startedAt) / 1e9);
      return result;
    } catch (error) {
      this.metrics.recordDependency('redis', 'failure', Number(process.hrtime.bigint() - startedAt) / 1e9);
      throw error;
    }
  }
  onModuleDestroy() { this.client.disconnect(); }
}
