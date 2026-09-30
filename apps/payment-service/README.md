# Payment Service

NestJS service that owns payment data, client idempotency records, and its PostgreSQL database. Its initial migration is in `migrations/001_initial.sql`. It will own payment lifecycle transitions and transactional outboxes.

## Local development

Start infrastructure with `npm run infra:up`, apply the migration with `npm run db:migrate`, and run `npm run start:payment`. Set `PAYMENT_DATABASE_URL` as shown in the root `.env.example`. Liveness is available at `GET /health`; readiness checks PostgreSQL at `GET /ready`.
