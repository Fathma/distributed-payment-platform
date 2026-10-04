import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { loadConfig } from '@payflow/config';

export class ProviderError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface ProviderCharge {
  idempotencyKey: string;
  paymentId: string;
  amount: number;
  currency: string;
}

export interface ProviderResult { providerReference: string }

@Injectable()
export class MockPaymentProvider implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: loadConfig().workerDatabaseUrl });

  async charge(charge: ProviderCharge): Promise<ProviderResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [charge.idempotencyKey]);
      const previous = await client.query<{ provider_reference: string }>('SELECT provider_reference FROM provider_outcomes WHERE idempotency_key = $1', [charge.idempotencyKey]);
    if (previous.rowCount) {
        await client.query('COMMIT');
        return { providerReference: previous.rows[0].provider_reference };
      }

    const configuredMode = (process.env.MOCK_PROVIDER_MODE ?? 'success').toLowerCase();
    let mode = configuredMode;
    if (mode === 'transient_then_success') {
      const attempts = await client.query<{ attempts: number }>(
        `INSERT INTO provider_attempts (idempotency_key, attempts) VALUES ($1, 1)
         ON CONFLICT (idempotency_key) DO UPDATE SET attempts = provider_attempts.attempts + 1, updated_at = now()
         RETURNING attempts`, [charge.idempotencyKey],
      );
      if (attempts.rows[0].attempts === 1) {
        await client.query('COMMIT');
        throw new ProviderError('PROVIDER_5XX', 'Mock provider returned one transient server error');
      }
      mode = 'success';
    }
    if (mode === 'random') {
      const successRate = Number(process.env.MOCK_PROVIDER_SUCCESS_RATE ?? '0.9');
      if (!Number.isFinite(successRate) || successRate < 0 || successRate > 1) throw new Error('MOCK_PROVIDER_SUCCESS_RATE must be between 0 and 1');
      mode = Math.random() < successRate ? 'success' : 'server_error';
    }

    if (mode === 'timeout') {
      const delay = Number(process.env.MOCK_PROVIDER_TIMEOUT_MS ?? '1500');
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
      throw new ProviderError('PROVIDER_TIMEOUT', 'Mock provider timed out');
    }
    if (mode === 'server_error') throw new ProviderError('PROVIDER_5XX', 'Mock provider returned a server error');
    if (mode === 'rate_limit') throw new ProviderError('PROVIDER_RATE_LIMIT', 'Mock provider rate limited the request');
    if (mode === 'network_error') throw new ProviderError('PROVIDER_NETWORK_ERROR', 'Mock provider network error');
    if (mode === 'decline') throw new ProviderError('PROVIDER_DECLINED', 'Mock provider declined the payment');
    if (mode !== 'success') throw new Error(`Unsupported MOCK_PROVIDER_MODE: ${configuredMode}`);

      const result = { providerReference: `mock_tx_${randomUUID()}` };
      await client.query('INSERT INTO provider_outcomes (idempotency_key, provider_reference) VALUES ($1, $2)', [charge.idempotencyKey, result.providerReference]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async onModuleDestroy() { await this.pool.end(); }
}
