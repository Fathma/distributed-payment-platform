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

9. **Create the Order Service API.** Implement order creation and retrieval, validate items and amounts, and persist orders in the `PENDING_PAYMENT` state.
10. **Create the Payment Service API and data model.** Create payment records, associate them with orders, and implement payment status retrieval and state transitions.
11. **Add the mock payment provider.** Make it configurable to return success, timeout, rate limit, network error, or server error so that failure paths can be exercised predictably.
12. **Publish payment requests and consume them in the worker.** Use a versioned `payment.requested` event, a stable payment ID as the message key, and a consumer group. The worker should call the mock provider and publish a success or failure result.
13. **Connect payment results back to orders.** Consume result events and update order status. Define what happens when events arrive late, more than once, or out of order.
14. **Run the first vertical-slice walkthrough.** Demonstrate order creation, asynchronous payment processing, and status retrieval. This establishes the core path before adding resilience features.

## Phase 4: Protect against duplicate work and failures

15. **Implement API idempotency.** Require an idempotency key for payment creation. Store the key, request hash, and response so repeated matching requests return the existing result; define how conflicting reuse is handled.
16. **Make worker processing safe to repeat.** Record payment processing outcomes so redelivered Kafka messages cannot cause a second business charge. Handle the case where the provider succeeds but the worker crashes before acknowledging the message.
17. **Add bounded retries with backoff and jitter.** Classify retryable and permanent failures, limit attempts, and make retry delays observable. Avoid indefinite retries.
18. **Add a dead-letter queue and reprocessing mechanism.** Preserve the original event, error details, attempt count, timestamp, and service name. Provide an admin-only way to inspect and reprocess DLQ messages safely.
19. **Define dependency outage behavior.** Document and implement how services behave during PostgreSQL, Redis, Kafka, and provider outages. For example, decide whether rate limiting fails open or closed and whether cache failures fall back to the database.

## Phase 5: Secure and expose the APIs

20. **Add JWT authentication and authorization.** Support customer and admin roles. Customers can access their own orders and payments; admins can inspect and reprocess DLQ entries.
21. **Complete gateway routing and validation.** Expose the agreed public APIs through the gateway, validate inputs, hide internal services, and propagate request and correlation IDs.
22. **Add Redis-backed rate limiting.** Choose and document a token bucket or sliding-window algorithm, with limits appropriate to the caller. Return `429 Too Many Requests` when the limit is exceeded.
23. **Add Redis caching.** Cache frequently read order or payment data with a defined TTL and invalidation/update behavior. Keep the database as the source of truth.

## Phase 6: Verify behavior and make it observable

24. **Add tests around core business rules.** Cover payment idempotency, order and payment state transitions, retry decisions, and rate limiting. Add integration tests for each service’s database and broker interactions.
25. **Add end-to-end scenarios.** Verify a successful payment, a transient provider failure followed by success, permanent failure into the DLQ and admin reprocessing, and duplicate Kafka delivery without a second charge.
26. **Add structured logs and metrics.** Carry request and correlation IDs through HTTP calls and events. Track HTTP counts, errors and latency; message processing and failures; payment outcomes; retries; DLQ volume; and database and Redis latency.
27. **Build Prometheus and Grafana views.** Add dashboards for service health, payment outcomes, retry and DLQ activity, request latency, and Kafka consumer lag. Use the dashboards to explain what happened during the end-to-end scenarios.
28. **Add distributed tracing if useful after the core flow is stable.** Trace a request across the gateway, services, Kafka, and worker using OpenTelemetry.

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
