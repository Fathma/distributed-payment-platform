# API Gateway

NestJS public HTTP entry point. It proxies order creation/list/retrieval and payment retrieval to the internal services. JWT authentication and Redis-backed rate limiting are planned for Phase 5.

## Local development

From the repository root, copy `.env.example` to `.env`, start infrastructure with `npm run infra:up`, then run `npm run start:gateway` (or start it in Docker with `npm run apps:up`). Liveness is available at `GET /health`; readiness checks Redis at `GET /ready`. Business routes are under `/api`.

Until Phase 5 authentication is implemented, the gateway uses the supplied `x-user-id` header or defaults to `usr_dev`. This is a development-only identity; do not expose the current gateway outside the local environment.
