# API Gateway

NestJS public HTTP entry point. It will own JWT authentication, request validation, Redis-backed rate limiting, request context, and routing to internal services.

## Local development

From the repository root, copy `.env.example` to `.env`, start infrastructure with `npm run infra:up`, then run `npm run start:gateway`. Liveness is available at `GET /health`; readiness checks Redis at `GET /ready`. Gateway business routes are under `/api`.
