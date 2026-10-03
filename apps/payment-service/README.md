# Payment Service

NestJS service that owns payment data, client idempotency records, and its PostgreSQL database. It creates one payment per order event, exposes payment retrieval, records worker outcomes, and publishes payment requests and normalized results through a transactional outbox. Its initial migration is in `migrations/001_initial.sql`.

## Local development

Start infrastructure with `npm run infra:up`, apply the migration with `npm run db:migrate`, and run `npm run start:payment`. Set `PAYMENT_DATABASE_URL` and `KAFKA_BROKERS` as shown in the root `.env.example`. Liveness is available at `GET /health`; readiness checks PostgreSQL and Kafka at `GET /ready`.
