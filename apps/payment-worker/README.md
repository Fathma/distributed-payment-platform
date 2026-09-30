# Payment Worker

NestJS HTTP health surface for the asynchronous payment worker. The worker will consume Kafka payment requests, call the mock provider, apply retry and deduplication rules, and publish results. It has no authoritative business database; the initial readiness check verifies Kafka connectivity.

## Local development

Start infrastructure with `npm run infra:up`, then run `npm run start:worker`. Liveness is available at `GET /health`; readiness checks Kafka at `GET /ready`.
