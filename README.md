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

The Phase 2 scaffold includes NestJS service shells, shared workspace packages, local PostgreSQL/Redis/Kafka/Prometheus/Grafana infrastructure, initial database migrations, and health/readiness endpoints. See [project-plan.md](project-plan.md) for progress and [plan.md](plan.md) for the full project requirements.

## Local development

Requirements: Node.js 22+, npm 10+, and Docker Compose.

1. Copy `.env.example` to `.env`.
2. Run `npm install` once to install workspace dependencies.
3. Start local dependencies with `npm run infra:up`.
4. Apply migrations using `npm run db:migrate --workspace @payflow/order-service` and `npm run db:migrate --workspace @payflow/payment-service`.
5. Start the four app containers with `npm run apps:up` (or start the entire Compose stack with `docker compose up -d --build`).

The worker and services currently expose health/readiness endpoints only; business routes and Kafka processing are implemented in later phases. To run an app directly on the host instead, use `npm run start:gateway`, `npm run start:order`, `npm run start:payment`, or `npm run start:worker`. Stop only the app containers with `npm run apps:down`; stop the whole stack with `npm run infra:down`.

## Technology direction

- TypeScript and NestJS
- PostgreSQL, Redis, and Kafka
- Docker Compose for local development
- Prometheus and Grafana for metrics and dashboards
- Jest and k6 for tests and load experiments
