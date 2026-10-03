# PayFlow API and event contracts

These contracts define the first implementation slice. JSON fields are camelCase. Timestamps use RFC 3339 UTC; money is an integer in the currency's minor unit (for BDT, poisha) to avoid floating-point arithmetic. Unknown fields may be rejected at public API boundaries. Event schemas are versioned independently from service deployments.

## Public API

All endpoints are exposed through the API Gateway. The target contract uses `Authorization: Bearer <JWT>`. JWT validation and role enforcement are scheduled for Phase 5; the current Phase 3 gateway accepts `x-user-id` or defaults to `usr_dev` for local walkthroughs. That development identity is not authentication and must not be exposed outside local development. The gateway generates `X-Request-Id` when absent and propagates `X-Correlation-Id`; if absent, it initializes the correlation ID from the request ID. Internal service calls and events preserve both values.

### Authentication

`POST /api/auth/login`

Request: `{ "email": "customer@example.test", "password": "..." }`

Response `200`: `{ "accessToken": "...", "tokenType": "Bearer", "expiresIn": 3600 }`

Initial development authentication may use seeded users; production-grade identity management is outside the project scope. JWT claims include `sub` (user ID), `role` (`CUSTOMER` or `ADMIN`), `iat`, and `exp`.

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

- `GET /api/orders/:id` — customer may read their own order; admin may read any.
- `GET /api/orders` — customer sees only their own orders; supports `cursor` and bounded `limit`.
- `POST /api/orders/:id/cancel` — customer may cancel only before processing begins; response contains the current order state.

Repeating a create request with the same user, key, and request body returns the original order result. Reusing a key with a different body returns `409 IDEMPOTENCY_KEY_CONFLICT`. Order creation idempotency is stored with the order in the Order Service; payment creation is separately constrained to one payment per `orderId`.

### Payments

- `GET /api/payments/:id` — customer may read a payment associated with their own order; admin may read any.
- `POST /api/payments/:id/retry` — admin only; requests a controlled retry/reprocess of an eligible failed payment and records the actor/reason. Customers cannot force provider retries directly.

Initial payment creation is event-driven from `order.created`, not a public `POST /payments` endpoint. This keeps ownership and the order-to-payment relationship unambiguous. A later client-initiated payment API would need its own documented authorization and idempotency semantics.

### Admin DLQ

- `GET /api/admin/dlq` — admin only; paginated list of dead-letter records with safe error summaries.
- `POST /api/admin/dlq/:id/reprocess` — admin only; requeues the original logical payment request and records the actor. Reprocessing must preserve the original payment/provider idempotency identity.

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
