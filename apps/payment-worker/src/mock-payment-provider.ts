import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

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
export class MockPaymentProvider {
  private readonly outcomes = new Map<string, ProviderResult>();

  async charge(charge: ProviderCharge): Promise<ProviderResult> {
    const previous = this.outcomes.get(charge.idempotencyKey);
    if (previous) return previous;

    const configuredMode = (process.env.MOCK_PROVIDER_MODE ?? 'success').toLowerCase();
    let mode = configuredMode;
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
    this.outcomes.set(charge.idempotencyKey, result);
    return result;
  }
}
