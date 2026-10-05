import { createHmac, randomUUID } from 'node:crypto';

const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.API_GATEWAY_PORT ?? 3000}`;
const secret = process.env.JWT_SECRET ?? 'local-only-change-this-jwt-secret-before-deploying';
const now = Math.floor(Date.now() / 1000);
const b64url = (value) => Buffer.from(value).toString('base64url');

function tokenFor(index) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub: `scale-probe-${index}-${randomUUID()}`,
    email: `scale-probe-${index}@example.test`,
    role: 'CUSTOMER',
    iat: now,
    exp: now + 3600,
  }));
  const input = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

const responses = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenFor(index)}`,
      'content-type': 'application/json',
      'idempotency-key': `scale-probe-${randomUUID()}`,
    },
    body: JSON.stringify({ items: [{ productId: 'scale-probe', quantity: 1, unitAmount: 100 }], currency: 'BDT' }),
  });
  if (response.status !== 202) throw new Error(`Scale probe order ${index} returned ${response.status}: ${await response.text()}`);
  return response.json();
}));

console.log(`Gateway accepted ${responses.length} concurrent scale-probe orders.`);
console.log(`scale_probe_order_ids=${responses.map((order) => order.id).join(',')}`);
