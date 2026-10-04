const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeOrder, hashOrderRequest, assertIdempotencyRequestMatches } = require('../../dist/apps/order-service/order-policy.js');
const { canTransitionPayment } = require('../../dist/apps/payment-service/payment-policy.js');
const { isRetryableProviderFailure, retryDelayMs } = require('../../dist/apps/payment-worker/retry-policy.js');
const { rateLimitPolicy } = require('../../dist/apps/api-gateway/auth/rate-limit-policy.js');
const { JwtAuthService } = require('../../dist/apps/api-gateway/auth/jwt-auth.service.js');

test('order normalization validates line items and computes integer minor-unit totals', () => {
  assert.deepEqual(normalizeOrder({ items: [{ productId: 'sku-a', quantity: 2, unitAmount: 1200 }], currency: 'bdt' }), {
    items: [{ productId: 'sku-a', quantity: 2, unitAmount: 1200 }], currency: 'BDT', totalAmount: 2400,
  });
  assert.throws(() => normalizeOrder({ items: [], currency: 'BDT' }), { status: 400 });
  assert.throws(() => normalizeOrder({ items: [{ productId: 'sku-a', quantity: 1.5, unitAmount: 3 }], currency: 'BDT' }), { status: 400 });
  assert.throws(() => normalizeOrder({ items: [{ productId: 'sku-a', quantity: 2, unitAmount: Number.MAX_SAFE_INTEGER }], currency: 'BDT' }), { status: 400 });
});

test('idempotency hashes normalized requests and rejects conflicting reuse', () => {
  const items = [{ productId: 'sku-a', quantity: 2, unitAmount: 1200 }];
  const hash = hashOrderRequest(items, 'BDT');
  assert.equal(hashOrderRequest(items, 'BDT'), hash);
  assert.doesNotThrow(() => assertIdempotencyRequestMatches(hash, hash));
  assert.throws(() => assertIdempotencyRequestMatches(hash, 'different-hash'), { status: 409 });
});

test('payment state transitions accept forward progress and block success reversal', () => {
  assert.equal(canTransitionPayment('PENDING', 'SUCCESS'), true);
  assert.equal(canTransitionPayment('PROCESSING', 'FAILED'), true);
  assert.equal(canTransitionPayment('FAILED', 'SUCCESS'), true);
  assert.equal(canTransitionPayment('SUCCESS', 'FAILED'), false);
});

test('provider retry policy treats declines as permanent and applies capped jittered backoff', () => {
  assert.equal(isRetryableProviderFailure('PROVIDER_DECLINED'), false);
  assert.equal(isRetryableProviderFailure('PROVIDER_5XX'), true);
  assert.equal(retryDelayMs(1, 1000, 10000, () => 0), 500);
  assert.equal(retryDelayMs(3, 1000, 2500, () => 1), 2500);
});

test('gateway rate policies separate login, writes, and reads', () => {
  assert.deepEqual(rateLimitPolicy('POST', '/api/auth/login'), { kind: 'login', limit: 10 });
  assert.deepEqual(rateLimitPolicy('POST', '/api/orders'), { kind: 'write', limit: 10 });
  assert.deepEqual(rateLimitPolicy('GET', '/api/orders'), { kind: 'read', limit: 120 });
});

test('JWT login issues customer and admin role claims and rejects bad credentials or tampering', () => {
  const auth = new JwtAuthService();
  const customer = auth.login('customer@example.test', 'customer-dev-password');
  assert.equal(auth.verify(customer.accessToken).role, 'CUSTOMER');
  const admin = auth.login('admin@example.test', 'admin-dev-password');
  assert.equal(auth.verify(admin.accessToken).role, 'ADMIN');
  assert.throws(() => auth.login('customer@example.test', 'wrong-password'), { status: 401 });
  assert.throws(() => auth.verify(`${customer.accessToken}x`), { status: 401 });
});
