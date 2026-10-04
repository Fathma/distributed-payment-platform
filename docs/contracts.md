# PayFlow API and event contracts

These contracts define the first implementation slice. JSON fields are camelCase. Timestamps use RFC 3339 UTC; money is an integer in the currency's minor unit (for BDT, poisha) to avoid floating-point arithmetic. Unknown fields may be rejected at public API boundaries. Event schemas are versioned independently from service deployments.

The interactive OpenAPI UI for public gateway routes is served at `/api/docs`; its generated JSON document is at `/api/docs-json`.

## Public API

All public endpoints are exposed through the API Gateway. Except for login and health checks, requests require `Authorization: Bearer <JWT>`. The gateway verifies HS256 tokens, derives user identity only from the verified subject, and forwards `X-User-Id` internally; caller-supplied identity headers are ignored. It generates `X-Request-Id` when absent and propagates `X-Correlation-Id`; if absent, it initializes the correlation ID from the request ID. Internal service calls and events preserve both values. Order, payment, and worker ports are not published by Compose.

### Authentication

`POST /api/auth/login`

Request: `{ "email": "customer@example.test", "password": "..." }`

Response `200`: `{ "accessToken": "...", "tokenType": "Bearer", "expiresIn": 3600 }`

Local development authentication uses customer/admin credentials configured by `DEV_CUSTOMER_*` and `DEV_ADMIN_*` environment variables. Replace all defaults, including `JWT_SECRET`, before shared deployment; production identity management is outside the project scope. JWT claims include `sub` (user ID), `role` (`CUSTOMER` or `ADMIN`), `iat`, and `exp`; tokens expire after one hour.

### Orders

`POST /api/orders` — customer only; requires `Idempotency-Key`.

```json
{
  "items": [
    { "productId": "prod_1", "quantity": 2, "unitAmount": 1500 }
  ],
  "currency": "BDT"
}
```

The service computes `totalAmount` from validated line items. Response `202`:

```json
{
  "id": "ord_123",
  "userId": "usr_456",
  "items": [{ "productId": "prod_1", "quantity": 2, "unitAmount": 1500 }],
  "totalAmount": 3000,
  "currency": "BDT",
  "status": "PENDING_PAYMENT",
  "paymentId": null,
  "createdAt": "2026-09-29T12:00:00Z"
}
```

The payment ID may initially be null because payment creation is asynchronous. The order GET response includes it once `payment.requested` is established.

- `GET /api/orders/:id` — customer may read their own order.
- `GET /api/orders` — customer sees only their own orders; supports bounded `limit` (1–100).

Repeating a create request with the same user, key, and request body returns the original order response snapshot. Reusing a key with a different body returns `409 IDEMPOTENCY_KEY_CONFLICT`. This order request starts the event-driven payment creation flow; payment creation is separately constrained to one payment per `orderId`.

### Payments

- `GET /api/payments/:id` — customer may read a payment associated with their own order; admin may read any.
Initial payment creation is event-driven from `order.created`, not a public `POST /payments` endpoint. This keeps ownership and the order-to-payment relationship unambiguous. A later client-initiated payment API would need its own documented authorization and idempotency semantics.

This release exposes payment reads plus the admin DLQ reprocessing path. Payment retry remains available only for a specific pending DLQ entry so the original event and provider identity stay linked.

### Admin DLQ

- `GET /api/admin/dlq` — admin only; list of up to 100 pending dead-letter records with safe error summaries.
- `POST /api/admin/dlq/:id/reprocess` — admin only; requeues the original logical payment request and preserves the original payment/provider idempotency identity. The gateway forwards a service token to the private worker and records the JWT subject as `X-Admin-Id`.

### Rate limits and caching

The gateway enforces Redis fixed-window limits: 10 writes per minute per authenticated user, 120 reads per minute per authenticated user, and 10 login requests per minute per IP. It returns `429` with `Retry-After` when a limit is exceeded and fails closed with `503` when Redis cannot enforce limits. Successful order/payment GET responses are cached per user and URL for 10 seconds. Redis cache errors fall back to the service/database; creating an order invalidates that user's cached order lists. Asynchronous payment status reads may be stale for up to the cache TTL.

### Errors

Error response shape:

```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order was not found",
    "requestId": "req_123"
  }
}
```

Use standard HTTP status codes: `400` invalid input, `401` unauthenticated, `403` forbidden, `404` not found, `409` state/idempotency conflict, `429` rate limited, `503` unavailable dependency, and `500` unexpected failure.

## Kafka event envelope

Every event uses this envelope and is serialized as JSON. Producers set the Kafka key to the aggregate ID (`orderId` for order events; `paymentId` for payment events).

```json
{
  "eventId": "evt_01...",
  "eventType": "payment.requested",
  "schemaVersion": 1,
  "occurredAt": "2026-09-29T12:00:00Z",
  "producer": "payment-service",
  "correlationId": "corr_123",
  "requestId": "req_123",
  "aggregateId": "pay_123",
  "data": {}
}
```

Consumers must tolerate duplicate delivery and ignore unknown optional fields. A breaking schema change requires a new schema version and a compatible rollout; do not repurpose an existing field.

### `order.created` (Order Service → Payment Service)

```json
{
  "orderId": "ord_123",
  "userId": "usr_456",
  "amount": 3000,
  "currency": "BDT",
  "idempotencyKey": "client-key-abc"
}
```

Contains the immutable purchase amount and currency used to create the payment. Payment Service enforces uniqueness on `orderId`; duplicate events resolve to the existing payment.

### `payment.requested` (Payment Service → Payment Worker)

```json
{
  "paymentId": "pay_123",
  "orderId": "ord_123",
  "amount": 3000,
  "currency": "BDT",
  "providerIdempotencyKey": "pay_123",
  "processingGeneration": 1
}
```

Each retry of the same payment uses the same provider idempotency key. An administrative reprocess does not generate a new charge identity.

### `payment.completed` and `payment.failed` (Worker → Payment Service)

```json
{
  "paymentId": "pay_123",
  "orderId": "ord_123",
  "providerReference": "mock_tx_789",
  "attemptCount": 2,
  "failureCode": null,
  "failureMessage": null,
  "processingGeneration": 1
}
```

For `payment.failed`, `providerReference` may be null and failure fields are populated. `payment.failed` represents exhausted/permanent failure, not an intermediate retryable attempt. Intermediate attempt failures are reported through metrics/logs and retry metadata, not as terminal payment outcomes.

### `payment.succeeded` / `payment.declined` (Payment Service → Order Service)

Payment Service emits a normalized business result after committing its payment state. Data includes `paymentId`, `orderId`, terminal status, and `providerReference` when available. Order Service applies the event idempotently and updates the order to `PAID` or `PAYMENT_FAILED`.

### DLQ record

After the configured maximum attempts, the dead-letter record preserves:

```json
{
  "dlqId": "dlq_123",
  "originalMessage": {},
  "error": "Payment provider timeout",
  "attempts": 4,
  "failedAt": "2026-09-29T12:00:00Z",
  "service": "payment-worker",
  "correlationId": "corr_123"
}
```

Do not include credentials, raw card data, or other secrets in events, logs, or DLQ payloads.

## Contract ownership

Order Service owns order commands and `order.created`; Payment Service owns payment creation and normalized payment outcomes; Payment Worker owns provider-attempt details and worker result events. Changes to this file should be reviewed alongside the owning service's implementation and any consumer compatibility needs.
