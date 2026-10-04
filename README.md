# PayFlow

PayFlow is a portfolio project for a distributed payment and order processing platform. It explores asynchronous payment processing, idempotency, retries, failure handling, and observability.

## Repository layout

```text
apps/                 Deployable services
  api-gateway/
  order-service/
  payment-service/
  payment-worker/
packages/             Shared libraries
infrastructure/       Local development and operations configuration
tests/e2e/             End-to-end test scaffolding
```

Each service owns its business logic and data boundaries. Shared packages are for cross-cutting code such as types, logging, and configuration; they should not become a place for service-specific logic.

## Architecture and contracts

- [Architecture and design decisions](docs/architecture.md)
- [HTTP API and Kafka event contracts](docs/contracts.md)
- [Phased implementation plan](project-plan.md)

## Getting started

The project includes NestJS services, local PostgreSQL/Redis/Kafka/Prometheus/Grafana infrastructure, database migrations, health/readiness endpoints, an asynchronous order-to-payment flow, and gateway JWT protection. See [project-plan.md](project-plan.md) for progress and [plan.md](plan.md) for the full project requirements.

## Local development

Requirements: Node.js 22+, npm 10+, and Docker Compose.

1. Copy `.env.example` to `.env`.
2. Start local dependencies with `npm run infra:up`.
3. Build and start the app containers with `npm run apps:up`. Compose applies the initial database migrations before starting Order and Payment Services. Or use `docker compose up -d --build` for the whole stack.

The gateway exposes `POST /api/auth/login`, `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`, `GET /api/payments/:id`, and admin-only DLQ operations. Log in with the local credentials in `.env.example`, then use the returned bearer token. Submit an order with an `Idempotency-Key` header; it returns `202` while Kafka processing continues. The mock provider mode can be set in `.env` with `MOCK_PROVIDER_MODE=success`, `timeout`, `server_error`, `rate_limit`, `network_error`, `decline`, or `random`.

Interactive OpenAPI documentation is available at `http://localhost:3000/api/docs`; the generated JSON document is at `http://localhost:3000/api/docs-json`. It describes the public gateway routes, request headers, order body, and common responses.

To run apps directly on the host, first run `npm install`, start infrastructure, apply migrations with `npm run db:migrate --workspace @payflow/order-service` and `npm run db:migrate --workspace @payflow/payment-service`, then use `npm run start:gateway`, `npm run start:order`, `npm run start:payment`, and `npm run start:worker`. Stop only the app containers with `npm run apps:down`; stop the whole stack with `npm run infra:down`.

## Technology direction

- TypeScript and NestJS
- PostgreSQL, Redis, and Kafka
- Docker Compose for local development
- Prometheus and Grafana for metrics and dashboards
- Jest and k6 for tests and load experiments
