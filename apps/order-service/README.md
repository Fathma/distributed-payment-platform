# Order Service

NestJS service that owns order data and its PostgreSQL database. It creates and retrieves orders, applies payment status events, enforces the current request idempotency key, and publishes `order.created` through a transactional outbox. Its initial migration is in `migrations/001_initial.sql`.

## Local development

Start infrastructure with `npm run infra:up`, apply the migration with `npm run db:migrate`, and run `npm run start:order`. Set `ORDER_DATABASE_URL` and `KAFKA_BROKERS` as shown in the root `.env.example`. Liveness is available at `GET /health`; readiness checks PostgreSQL and Kafka at `GET /ready`.
