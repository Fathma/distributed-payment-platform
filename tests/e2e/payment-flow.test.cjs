const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Kafka } = require('kafkajs');
const { Pool } = require('pg');

const gateway = process.env.E2E_GATEWAY_URL ?? `http://localhost:${process.env.API_GATEWAY_PORT ?? 3000}`;
const kafkaBrokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const workerDb = new Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? 'postgresql://worker_app:worker_dev_password@localhost:5432/worker_db' });
const orderDb = new Pool({ connectionString: process.env.ORDER_DATABASE_URL ?? 'postgresql://order_app:order_dev_password@localhost:5432/order_db' });
const paymentDb = new Pool({ connectionString: process.env.PAYMENT_DATABASE_URL ?? 'postgresql://payment_app:payment_dev_password@localhost:5432/payment_db' });
const kafka = new Kafka({ clientId: `payflow-e2e-${randomUUID()}`, brokers: kafkaBrokers });
const exercisedOrderIds = [];

async function login(email, password) {
  const response = await fetch(`${gateway}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200, `login failed: ${await response.text()}`);
  return (await response.json()).accessToken;
}

function api(token, pathName, options = {}) {
  return fetch(`${gateway}${pathName}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
}

async function createOrder(token) {
  const response = await api(token, '/api/orders', {
    method: 'POST',
    headers: { 'idempotency-key': `e2e-${randomUUID()}` },
    body: JSON.stringify({ items: [{ productId: 'e2e-sku', quantity: 1, unitAmount: 1777 }], currency: 'BDT' }),
  });
  assert.equal(response.status, 202, `order was not accepted: ${await response.text()}`);
  const order = await response.json();
  exercisedOrderIds.push(order.id);
  return order;
}

async function waitForOrder(token, orderId, expectedStatus, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await api(token, `/api/orders/${orderId}`, { headers: { 'cache-control': 'no-cache' } });
    if (response.ok) {
      const order = await response.json();
      if (order.status === expectedStatus) return order;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Order ${orderId} did not reach ${expectedStatus}`);
}

async function waitForPayment(token, paymentId, expectedStatus, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await api(token, `/api/payments/${paymentId}`, { headers: { 'cache-control': 'no-cache' } });
    if (response.ok) {
      const payment = await response.json();
      if (payment.status === expectedStatus) return payment;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Payment ${paymentId} did not reach ${expectedStatus}`);
}

function setWorkerMode(mode) {
  execFileSync('docker', ['compose', 'up', '-d', '--no-deps', '--force-recreate', 'payment-worker'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, MOCK_PROVIDER_MODE: mode, PAYMENT_MAX_ATTEMPTS: '2', PAYMENT_RETRY_BASE_MS: '200', PAYMENT_RETRY_MAX_MS: '500' },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      execFileSync('docker', ['compose', 'exec', '-T', 'payment-worker', 'node', '-e', "fetch('http://127.0.0.1:3003/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], {
        cwd: path.resolve(__dirname, '../..'), stdio: 'ignore', timeout: 3000,
      });
      return;
    } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  throw new Error(`Payment Worker failed to become ready in mode ${mode}`);
}

async function capturePaymentRequest(orderId) {
  const consumer = kafka.consumer({ groupId: `payflow-e2e-${randomUUID()}` });
  await consumer.connect();
  await consumer.subscribe({ topic: 'payment.requested', fromBeginning: false });
  let resolveEvent;
  let rejectEvent;
  const eventPromise = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
  const timer = setTimeout(() => rejectEvent(new Error(`No payment.requested event for ${orderId}`)), 20_000);
  await consumer.run({ eachMessage: async ({ message }) => {
    if (!message.value) return;
    const event = JSON.parse(message.value.toString());
    if (event.data.orderId === orderId) { clearTimeout(timer); resolveEvent(event); }
  } });
  return { consumer, eventPromise };
}

test('authenticated payment flow covers success, retry, DLQ reprocessing, and duplicate delivery', { timeout: 240_000 }, async (t) => {
  const customerToken = await login(process.env.DEV_CUSTOMER_EMAIL ?? 'customer@example.test', process.env.DEV_CUSTOMER_PASSWORD ?? 'customer-dev-password');
  const adminToken = await login(process.env.DEV_ADMIN_EMAIL ?? 'admin@example.test', process.env.DEV_ADMIN_PASSWORD ?? 'admin-dev-password');

  await t.test('successful order reaches paid and payment success', async () => {
    setWorkerMode('success');
    const created = await createOrder(customerToken);
    const order = await waitForOrder(customerToken, created.id, 'PAID');
    const payment = await waitForPayment(customerToken, order.paymentId, 'SUCCESS');
    assert.equal(payment.amount, 1777);
  });

  await t.test('transient provider failure retries and later succeeds', async () => {
    setWorkerMode('transient_then_success');
    const created = await createOrder(customerToken);
    const order = await waitForOrder(customerToken, created.id, 'PAID');
    const payment = await waitForPayment(customerToken, order.paymentId, 'SUCCESS');
    assert.ok(payment.attemptCount >= 2, `expected retry count >= 2, received ${payment.attemptCount}`);
  });

  await t.test('permanent decline enters DLQ and admin reprocessing can recover', async () => {
    setWorkerMode('decline');
    const created = await createOrder(customerToken);
    const failedOrder = await waitForOrder(customerToken, created.id, 'PAYMENT_FAILED');
    const list = await api(adminToken, '/api/admin/dlq');
    assert.equal(list.status, 200);
    const dlqRows = await list.json();
    const entry = dlqRows.find((row) => row.payment_id === failedOrder.paymentId);
    assert.ok(entry, 'failed payment was not present in the admin DLQ');

    setWorkerMode('success');
    const reprocess = await api(adminToken, `/api/admin/dlq/${entry.dlq_id}/reprocess`, { method: 'POST' });
    assert.equal(reprocess.status, 200, await reprocess.text());
    const paidOrder = await waitForOrder(customerToken, created.id, 'PAID');
    const payment = await waitForPayment(customerToken, paidOrder.paymentId, 'SUCCESS');
    assert.equal(payment.id, failedOrder.paymentId);
  });

  await t.test('duplicate payment.requested delivery does not create another provider outcome', async () => {
    setWorkerMode('success');
    const created = await createOrder(customerToken);
    const capture = await capturePaymentRequest(created.id);
    const event = await capture.eventPromise;
    await capture.consumer.disconnect();
    const producer = kafka.producer();
    await producer.connect();
    await producer.send({ topic: 'payment.requested', messages: [{ key: event.data.paymentId, value: JSON.stringify(event) }] });
    await producer.disconnect();
    await waitForPayment(customerToken, (await waitForOrder(customerToken, created.id, 'PAID')).paymentId, 'SUCCESS');
    const result = await workerDb.query('SELECT count(*)::int AS count FROM provider_outcomes WHERE idempotency_key = $1', [event.data.providerIdempotencyKey]);
    assert.equal(result.rows[0].count, 1);
  });

  const metrics = await fetch(`${gateway}/metrics`);
  assert.equal(metrics.status, 200);
  assert.match(await metrics.text(), /payflow_http_requests_total/);

  const orders = await orderDb.query('SELECT count(*)::int AS count FROM orders WHERE id = ANY($1::text[]) AND status = \'PAID\'', [exercisedOrderIds]);
  const payments = await paymentDb.query('SELECT count(*)::int AS count FROM payments WHERE order_id = ANY($1::text[]) AND status = \'SUCCESS\'', [exercisedOrderIds]);
  const orderOutbox = await orderDb.query("SELECT count(*)::int AS count FROM order_outbox WHERE aggregate_id = ANY($1::text[]) AND event_type = 'order.created'", [exercisedOrderIds]);
  const paymentInbox = await paymentDb.query('SELECT count(*)::int AS count FROM payment_inbox WHERE event_id IN (SELECT event_id FROM order_outbox WHERE aggregate_id = ANY($1::text[]))', [exercisedOrderIds]);
  assert.equal(orders.rows[0].count, exercisedOrderIds.length, 'order database did not persist every paid order');
  assert.equal(payments.rows[0].count, exercisedOrderIds.length, 'payment database did not persist every successful payment');
  assert.equal(orderOutbox.rows[0].count, exercisedOrderIds.length, 'order database outbox did not persist each order event');
  assert.ok(paymentInbox.rows[0].count >= exercisedOrderIds.length, 'payment database inbox did not record consumed events');
});

test.after(async () => {
  try { setWorkerMode('success'); } catch { /* Keep cleanup best-effort if the stack has already stopped. */ }
  await Promise.all([workerDb.end(), orderDb.end(), paymentDb.end()]);
});
