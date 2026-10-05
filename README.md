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

The project includes NestJS services, local PostgreSQL/Redis/Kafka/Prometheus/Grafana infrastructure, database migrations, health/readiness endpoints, an asynchronous order-to-payment flow, gateway JWT protection, and service metrics. See [project-plan.md](project-plan.md) for progress and [plan.md](plan.md) for the full project requirements.

## Local development

Requirements: Node.js 22+, npm 10+, and Docker Compose.

1. Copy `.env.example` to `.env`.
2. Start local dependencies with `npm run infra:up`.
3. Build and start the app containers with `npm run apps:up`. Compose applies the initial database migrations before starting Order and Payment Services. Or use `docker compose up -d --build` for the whole stack.

The gateway exposes `POST /api/auth/login`, `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`, `GET /api/payments/:id`, and admin-only DLQ operations. Log in with the local credentials in `.env.example`, then use the returned bearer token. Submit an order with an `Idempotency-Key` header; it returns `202` while Kafka processing continues. The mock provider mode can be set in `.env` with `MOCK_PROVIDER_MODE=success`, `timeout`, `server_error`, `rate_limit`, `network_error`, `decline`, or `random`.

Interactive OpenAPI documentation is available at `http://localhost:3000/api/docs`; the generated JSON document is at `http://localhost:3000/api/docs-json`. It describes the public gateway routes, request headers, order body, and common responses.

## Tests and observability

Run `npm run test:unit` for business-rule tests. With Docker Compose running and the databases, Kafka, and app services healthy, run `npm run test:e2e` for the success, retry, DLQ recovery, duplicate delivery, and service database/outbox checks. The e2e suite changes the mock provider mode by recreating the worker container and restores it to `success` afterward. It uses the local credentials and connection URLs from `.env` (or `.env.example` defaults).

Prometheus scrapes `/metrics` on all four services over the private Compose network. The gateway metrics endpoint is also reachable at `http://localhost:3000/metrics`. Open Grafana at `http://localhost:3004` to view the provisioned **PayFlow Overview** dashboard. It charts scrape health, HTTP rate/errors/latency, payment outcomes, retries and DLQ actions, Kafka consumer lag, and dependency latency. Structured JSON logs include request and correlation IDs; OpenTelemetry tracing is deferred until span-level diagnosis is useful.

## Scaling and load exercises

Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) and start the full Compose stack. Set `JWT_SECRET` in the shell to the same value used by the gateway (the default from `.env.example` is used if omitted). Run `npm run load:normal`, `npm run load:high`, or `npm run load:spike`; each profile submits authenticated orders with unique test users and waits for payment completion. Per-user pacing stays below the gateway's write limit. The test uses the mock provider, so use a local stack and expect test records in the databases.

Run `npm run scale:check` to briefly scale Order Service and Payment Worker to two replicas, inspect their Kafka group assignments, and restore the prior replica counts. See [failure drills](tests/scale/failure-drills.md) for worker/provider and dependency outages, and run `bash tests/scale/capture-runtime.sh` after a load profile to save Docker resource use, PostgreSQL counters, HTTP percentiles/error rates, payment outcomes, retries, DLQ activity, and consumer lag. Generated snapshots are ignored under `tests/results/`. Phase 7 performance results remain unreported until these exercises run on the target machine.

To run apps directly on the host, first run `npm install`, start infrastructure, apply migrations with `npm run db:migrate --workspace @payflow/order-service` and `npm run db:migrate --workspace @payflow/payment-service`, then use `npm run start:gateway`, `npm run start:order`, `npm run start:payment`, and `npm run start:worker`. Stop only the app containers with `npm run apps:down`; stop the whole stack with `npm run infra:down`.

## Technology direction

- TypeScript and NestJS
- PostgreSQL, Redis, and Kafka
- Docker Compose for local development
- Prometheus and Grafana for metrics and dashboards
- Node.js built-in test runner for business-rule and Compose-backed end-to-end tests; k6 for load experiments
