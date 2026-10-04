import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '@payflow/config';
import { log } from '@payflow/logger';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client = new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500 });

  constructor() {
    this.client.on('error', (error) => log('warn', 'Gateway Redis request failed', { service: 'api-gateway', error: error.message }));
  }

  async consumeFixedWindow(key: string): Promise<[number, number]> {
    const result = await this.client.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return {count, redis.call('TTL', KEYS[1])}",
      1, key, 60,
    ) as [number, number];
    return [Number(result[0]), Number(result[1])];
  }

  get(key: string) { return this.client.get(key); }
  set(key: string, value: string, seconds: number) { return this.client.set(key, value, 'EX', seconds); }
  del(...keys: string[]) { return keys.length ? this.client.del(...keys) : Promise.resolve(0); }
  smembers(key: string) { return this.client.smembers(key); }
  sadd(key: string, member: string) { return this.client.sadd(key, member); }
  expire(key: string, seconds: number) { return this.client.expire(key, seconds); }
  onModuleDestroy() { this.client.disconnect(); }
}
