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

This repository is at the scaffold stage. The first implementation step is to add the NestJS services and local infrastructure. See [plan.md](plan.md) for the project requirements and intended milestones.

## Technology direction

- TypeScript and NestJS
- PostgreSQL, Redis, and Kafka
- Docker Compose for local development
- Prometheus and Grafana for metrics and dashboards
- Jest and k6 for tests and load experiments
