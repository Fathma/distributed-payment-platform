# PayFlow step-by-step project plan

The repository is currently at the scaffold stage, so this plan starts with agreeing on the core design and making a minimal vertical slice work, then adds reliability, operations, and scale. Keep the first release focused on orders and payments; skip the e-commerce features listed in `plan.md` as out of scope.

## Phase 1: Define the system

1. [x] **Confirm the service boundaries and request flow.** Write down which service owns each API, database, and event. The gateway handles client traffic; Order Service owns orders; Payment Service owns payments and idempotency; Payment Worker handles provider calls. See [architecture](docs/architecture.md).
2. [x] **Define shared contracts.** Specify the API request/response shapes, order and payment state transitions, and versioned Kafka event schemas. Include correlation IDs and stable message keys, such as `paymentId`. See [contracts](docs/contracts.md).
3. [x] **Decide the payment consistency strategy.** Document how order creation, payment creation, and event publication stay consistent when a process or dependency fails. Choose a transaction-outbox approach or explicitly document another approach and its failure modes. PayFlow uses transactional outboxes, at-least-once delivery, idempotent consumers, and provider idempotency.
4. [x] **Write architecture documentation.** Add a system diagram, service responsibilities, data ownership, and the initial choices for retries, idempotency, rate limiting, and failure handling. Update it as implementation decisions become real.

## Phase 2: Make the project runnable

5. [x] **Establish the TypeScript monorepo.** Set up workspace scripts, TypeScript configuration, NestJS service scaffolds, shared types, configuration, and structured logging. Add local commands and Docker images for building and running each service.
6. [x] **Add local infrastructure.** Configure Docker Compose for PostgreSQL, Redis, Kafka, Prometheus, Grafana, and the four app containers, with service health checks and persistent development data where appropriate.
7. [x] **Add database migrations and ownership boundaries.** Create separate order and payment schemas or databases. Add migrations for orders, payments, and idempotency records. Keep each service responsible for its own data.
8. [x] **Implement health and readiness endpoints.** Each service should expose liveness and readiness checks. Readiness should report the dependencies that service actually needs.

## Phase 3: Build the end-to-end payment flow

9. [x] **Create the Order Service API.** Implement order creation and retrieval, validate items and amounts, and persist orders in the `PENDING_PAYMENT` state. Order writes and `order.created` outbox rows commit together.
10. [x] **Create the Payment Service API and data model.** Consume order events, create one payment per order, expose payment status retrieval, and apply payment state transitions with an outbox.
11. [x] **Add the mock payment provider.** Configure success, timeout, rate limit, network error, server error, decline, and random success-rate modes.
12. [x] **Publish payment requests and consume them in the worker.** Use versioned `payment.requested` events keyed by payment ID and a worker consumer group. The worker calls the mock provider and publishes a completion or failure result.
13. [x] **Connect payment results back to orders.** Payment Service consumes worker results, writes normalized outcome events, and Order Service updates order status.
14. [x] **Run the first vertical-slice walkthrough.** Verified a gateway order request returned `202`, then the order reached `PAID` and the matching payment reached `SUCCESS` with a provider reference.

## Phase 4: Protect against duplicate work and failures

15. [x] **Implement API idempotency.** The order request that starts payment creation requires a key; the Order Service stores its request hash and original response snapshot. Conflicting reuse returns `409`, and one payment per order is enforced by a database uniqueness constraint.
16. [x] **Make worker processing safe to repeat.** Persist worker jobs before acknowledging Kafka, and persist successful mock-provider outcomes by the stable payment idempotency key so restarts/re-delivery cannot charge twice.
17. [x] **Add bounded retries with backoff and jitter.** Retry transient provider failures up to a configurable limit with persisted exponential delays and jitter; declines are permanent.
18. [x] **Add a dead-letter queue and reprocessing mechanism.** Persist full original events and failure metadata, publish `payment.dlq`, and provide token-protected worker endpoints to inspect/reprocess while preserving payment/provider identity.
19. [x] **Define dependency outage behavior.** Document PostgreSQL, Redis, Kafka, and provider policies; readiness exposes required dependencies, database/broker write failures prevent acknowledgement, and retries resume from durable state.

## Phase 5: Secure and expose the APIs

20. [x] **Add JWT authentication and authorization.** Support customer and admin roles. Customers access only their own orders and payments; admins inspect and reprocess DLQ entries.
21. [x] **Complete gateway routing and validation.** Expose the agreed public APIs through the gateway, validate inputs, keep internal services off published Compose ports, and propagate request and correlation IDs.
22. [x] **Add Redis-backed rate limiting.** Use atomic fixed windows: 10 writes/minute per user, 120 reads/minute per user, and 10 login attempts/minute per IP. Return `429` with `Retry-After`; fail closed with `503` if Redis is unavailable.
23. [x] **Add Redis caching.** Cache successful user-scoped order and payment GET responses for 10 seconds. Cache failures fall back to services; order creation invalidates that user's order-list entries. Payment status can be stale up to the TTL while asynchronous processing catches up.

## Phase 6: Verify behavior and make it observable

24. [x] **Add tests around core business rules.** Cover order validation/idempotency, payment state transitions, retry decisions, rate-limit policy, and JWT role/tampering. E2E assertions also inspect each service’s database and Kafka-driven inbox/outbox records. Run with `npm run test:unit` and `npm run test:e2e`.
25. [x] **Add end-to-end scenarios.** Added runnable scenarios for payment success, transient retry, permanent failure into the DLQ and admin reprocessing, and duplicate Kafka delivery without a second provider outcome.
26. [x] **Add structured logs and metrics.** Request/correlation IDs continue through HTTP calls and events. Added per-service Prometheus metrics for HTTP counts/status/latency, Kafka message processing and lag, payment outcomes/duration, retries, DLQ actions, and dependency latency including Redis commands.
27. [x] **Build Prometheus and Grafana views.** Prometheus scrapes the services over the private Compose network; Grafana provisions a dashboard for scrape health, HTTP rate/errors/latency, payment outcomes, retries/DLQ, consumer lag, and dependency latency.
28. [x] **Evaluate distributed tracing after the core flow is stable.** Deferred OpenTelemetry: the phase’s metrics and correlated structured logs cover the current local demo; tracing can be added if cross-service diagnosis needs sampling and span detail.

## Phase 7: Demonstrate operation at scale

29. **Verify horizontal scaling.** Run multiple Order Service instances and Payment Workers. Confirm that gateway traffic is distributed and Kafka partitions are shared across workers in the consumer group.
30. **Run controlled load tests with k6.** Measure normal, high-load, and spike scenarios. Record p50, p95, and p99 latency, throughput, error rate, resource use, database performance, and Kafka lag. Report measured results only.
31. **Exercise failure scenarios.** Stop workers, make the provider unavailable, interrupt database and Redis access, and redeliver duplicate messages. Record observed behavior and confirm recovery matches the documented design.

## Phase 8: Prepare the project for review

32. **Add CI with GitHub Actions.** Run linting, tests, and builds; add integration checks and dependency or security checks as the project supports them.
33. **Polish the README and architecture docs.** Explain how to start the stack, how the services and events fit together, reliability guarantees and limitations, scaling behavior, measured load-test results, and trade-offs.
34. **Rehearse the “done” demonstration.** Show an authenticated and rate-limited order request, asynchronous payment, a failure and retry or DLQ path, duplicate-message protection, order status update, and the logs and metrics that explain the result. Be ready to discuss delivery guarantees, provider timeouts, data ownership, and recovery behavior.

## Suggested milestones

- **Runnable scaffold:** Phases 1–2
- **Working payment flow:** Phase 3
- **Reliable payment handling:** Phase 4
- **Secured, observable APIs:** Phases 5–6
- **Scale and portfolio readiness:** Phases 7–8

The first practical milestone is the **working payment flow**. It proves the architecture before the project grows into operational and scaling work.
