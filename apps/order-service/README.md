# Order Service

NestJS service that owns order data and its PostgreSQL database. Its initial migration is in `migrations/001_initial.sql`. It will own order creation, retrieval, lifecycle transitions, and the transactional outbox for order events.

## Local development

Start infrastructure with `npm run infra:up`, apply the migration with `npm run db:migrate`, and run `npm run start:order`. Set `ORDER_DATABASE_URL` as shown in the root `.env.example`. Liveness is available at `GET /health`; readiness checks PostgreSQL at `GET /ready`.
