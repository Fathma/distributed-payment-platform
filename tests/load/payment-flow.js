import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { hmac } from 'k6/crypto';
import encoding from 'k6/encoding';

const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
const jwtSecret = __ENV.JWT_SECRET || 'local-only-change-this-jwt-secret-before-deploying';
const profile = __ENV.K6_PROFILE || 'normal';

const completedPayments = new Counter('payment_flows_completed');
const flowFailures = new Counter('payment_flow_failures');
const orderAccepted = new Rate('order_accepted_rate');
const flowDuration = new Trend('payment_flow_duration_ms', true);

const profiles = {
  normal: [
    { duration: '1m', target: 5 },
    { duration: '3m', target: 5 },
    { duration: '1m', target: 0 },
  ],
  high: [
    { duration: '1m', target: 20 },
    { duration: '5m', target: 20 },
    { duration: '1m', target: 0 },
  ],
  spike: [
    { duration: '15s', target: 5 },
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 5 },
    { duration: '30s', target: 0 },
  ],
};

if (!profiles[profile]) throw new Error(`Unknown K6_PROFILE '${profile}'; choose normal, high, or spike`);

export const options = {
  scenarios: {
    payment_flow: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: profiles[profile],
      gracefulRampDown: '90s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    order_accepted_rate: ['rate>0.99'],
    payment_flow_failures: ['count==0'],
    payment_flow_duration_seconds: ['p(95)<45000', 'p(99)<90000'],
  },
};

function base64url(value) {
  return encoding.b64encode(value, 'rawurl');
}

function tokenFor(vu) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    sub: `load-customer-${vu}`,
    email: `load-customer-${vu}@example.test`,
    role: 'CUSTOMER',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const signature = hmac('sha256', jwtSecret, signingInput, 'base64rawurl');
  return `${signingInput}.${signature}`;
}

function request(path, token, params = {}) {
  return http.request(params.method || 'GET', `${baseUrl}${path}`, params.body || null, {
    headers: { authorization: `Bearer ${token}`, ...(params.headers || {}) },
    tags: params.tags,
    timeout: '10s',
  });
}

export default function () {
  const token = tokenFor(__VU);
  const startedAt = Date.now();
  const key = `k6-${profile}-${__VU}-${__ITER}`;
  const created = request('/api/orders', token, {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: 'load-test-sku', quantity: 1, unitAmount: 1250 }], currency: 'BDT' }),
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    tags: { endpoint: 'create_order' },
  });
  const accepted = check(created, {
    'order accepted': (response) => response.status === 202,
  });
  orderAccepted.add(accepted);

  if (!accepted) {
    flowFailures.add(1);
    sleep(6.5);
    return;
  }

  const order = created.json();
  const deadline = Date.now() + 90_000;
  let terminal = false;
  while (Date.now() < deadline) {
    const response = request(`/api/orders/${order.id}`, token, {
      headers: { 'cache-control': 'no-cache' },
      tags: { endpoint: 'get_order' },
    });
    if (response.status === 200) {
      const current = response.json();
      if (current.status === 'PAID') {
        terminal = true;
        completedPayments.add(1);
        break;
      }
      if (current.status === 'PAYMENT_FAILED') break;
    }
    sleep(1);
  }

  const durationMs = Date.now() - startedAt;
  flowDuration.add(durationMs);
  if (!terminal) flowFailures.add(1);

  // Keep each signed user's order rate under the gateway's 10 writes/minute limit.
  sleep(Math.max(0, 6.5 - durationMs / 1000));
}
