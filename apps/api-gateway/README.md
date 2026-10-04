# API Gateway

NestJS public HTTP entry point. It authenticates JWTs, validates public requests, enforces Redis-backed rate limits, and proxies order/payment/DLQ calls to services that have no published Compose ports. Redis also caches successful order/payment reads for ten seconds.

## Local development

From the repository root, copy `.env.example` to `.env`, start infrastructure with `npm run infra:up`, then run `npm run start:gateway` (or start it in Docker with `npm run apps:up`). Liveness is available at `GET /health`; readiness checks Redis at `GET /ready`. Business routes and Swagger UI are under `/api`.

`POST /api/auth/login` exchanges the configured local customer/admin credentials for a one-hour HS256 JWT. Use `Authorization: Bearer <token>` for all other routes. The seeded environment credentials and default signing secret are for local development only; replace them before any shared deployment. The gateway ignores caller-supplied `x-user-id` and forwards the subject from the verified token.

Rate limits use Redis fixed windows: 10 writes per minute per user, 120 reads per minute per user, and 10 login attempts per minute per client IP. Requests fail closed with `503` when Redis cannot enforce limits. Cache reads are user-scoped and fall back to the service/database on Redis errors; a successful order creation invalidates the caller's cached order lists. Payment status can be stale for up to the ten-second cache TTL while asynchronous events are processing.

Example login:

```sh
curl -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"customer@example.test","password":"customer-dev-password"}'
```
