# Payment Worker

NestJS HTTP health surface and Kafka consumer for the asynchronous payment worker. It consumes `payment.requested`, calls the configurable mock provider, and publishes `payment.completed` or `payment.failed`. It has no authoritative business database; bounded retries and a DLQ are planned for Phase 4.

## Local development

Start infrastructure with `npm run infra:up`, then run `npm run start:worker`. Liveness is available at `GET /health`; readiness checks Kafka at `GET /ready`.

The mock provider reads `MOCK_PROVIDER_MODE` (`success`, `timeout`, `server_error`, `rate_limit`, `network_error`, `decline`, or `random`). `MOCK_PROVIDER_SUCCESS_RATE` controls the probability used by `random`; `MOCK_PROVIDER_TIMEOUT_MS` sets simulated timeout duration. Compose defaults to `success`.
