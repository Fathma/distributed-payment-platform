# Payment Worker

NestJS worker for asynchronous payment processing. It persists each request in its operational PostgreSQL database before committing the Kafka offset, then processes jobs with bounded exponential backoff and jitter. Provider idempotency outcomes are durable across worker restarts. Exhausted/permanent failures are recorded in PostgreSQL and published to `payment.dlq`; the worker then publishes the terminal `payment.failed` result.

## Local development

Start infrastructure with `npm run infra:up`, apply migrations with `npm run db:migrate`, then run `npm run start:worker`. Set `WORKER_DATABASE_URL`, `KAFKA_BROKERS`, and `DLQ_ADMIN_TOKEN`. Liveness is available at `GET /health`; readiness checks Kafka and PostgreSQL at `GET /ready`.

DLQ operations use `GET /admin/dlq` and `POST /admin/dlq/:id/reprocess`, protected by `X-Admin-Token`; provide `X-Admin-Id` to record the operator. Reprocessing creates a new delivery job while preserving the payment ID and provider idempotency key. Keep the token private. This local token guard is replaced by gateway JWT role checks in Phase 5.

`PAYMENT_MAX_ATTEMPTS` defaults to 4, `PAYMENT_RETRY_BASE_MS` to 1000, and `PAYMENT_RETRY_MAX_MS` to 30000. Retry delays use exponential backoff with 50–100% jitter.

The mock provider reads `MOCK_PROVIDER_MODE` (`success`, `timeout`, `server_error`, `rate_limit`, `network_error`, `decline`, or `random`). `MOCK_PROVIDER_SUCCESS_RATE` controls the probability used by `random`; `MOCK_PROVIDER_TIMEOUT_MS` sets simulated timeout duration. Compose defaults to `success`.
