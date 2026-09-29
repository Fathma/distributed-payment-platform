Portfolio Project: High-Volume Payment Processing Platform
Working name
PayFlow — a distributed payment/order processing platform.
The system simulates an e-commerce/payment backend where thousands of requests can arrive concurrently, but payment processing must be reliable and must never accidentally charge the customer twice.

1. The business scenario
A client application creates an order and requests payment.
Example:

Customer
   ↓
API Gateway
   ↓
Order Service
   ↓
Payment Service
   ↓
Kafka
   ↓
Payment Worker
   ↓
Mock Payment Provider
The important part is that creating an order should not require every downstream operation to complete synchronously.
For example:

Client creates an order.
Order is stored in PostgreSQL.
Payment request is created.
An event is published to Kafka.
Payment worker processes it asynchronously.
Mock payment provider responds.
Payment status is updated.
Order status changes accordingly.
Client can query the order/payment status.
2. Services
Build four services.
1. API Gateway
Responsibilities:
Authentication
Request validation
Rate limiting
Routing
Request IDs / correlation IDs
Basic logging
Hide internal services from clients
Example:
POST /api/orders
GET  /api/orders/:id
POST /api/payments/:id/retry
GET  /api/payments/:id
The client should communicate only with the gateway.
2. Order Service
Responsible for:
Creating orders
Retrieving orders
Updating order status
Order persistence
Publishing order events
Example order:
{
  "id": "ord_123",
  "userId": "usr_456",
  "items": [
    {
      "productId": "prod_1",
      "quantity": 2,
      "price": 1500
    }
  ],
  "totalAmount": 3000,
  "currency": "BDT",
  "status": "PENDING_PAYMENT"
}
Possible states:
PENDING_PAYMENT
PAYMENT_PROCESSING
PAID
PAYMENT_FAILED
CANCELLED
3. Payment Service
Responsible for:
Creating payment records
Payment state management
Idempotency
Publishing payment events
Communicating with the payment worker/provider
Payment states:
PENDING
PROCESSING
SUCCESS
FAILED
Important:
Payment Service must guarantee that the same payment request isn't processed twice.

4. Payment Worker
This is where the asynchronous processing happens.
It:

Consumes Kafka messages
Processes payments
Calls a mock external payment provider
Handles failures
Retries failed payments
Sends permanently failed messages to DLQ
Updates payment status
Publishes payment result events
This is one of the most important parts of the project.
3. Database requirements
Use PostgreSQL.
You can initially give each service its own database/schema.

For example:

PostgreSQL
│
├── order_db
│   └── orders
│
└── payment_db
    ├── payments
    └── idempotency_keys
You should intentionally demonstrate service-owned data rather than having every service freely query every table.
Orders
orders
-------
id
user_id
total_amount
currency
status
created_at
updated_at
Payments
payments
--------
id
order_id
amount
currency
status
provider_reference
attempt_count
created_at
updated_at
Idempotency
idempotency_keys
----------------
key
request_hash
response
status
created_at
expires_at
4. Kafka requirements
Kafka is a major part of the project.
Create topics such as:

order.created
payment.requested
payment.completed
payment.failed
Example:
Order Service
     │
     │ payment.requested
     ↓
   Kafka
     │
     ↓
Payment Worker
     │
     │ payment.completed
     ↓
   Kafka
     │
     ↓
Order Service
You should use:
partitions
consumer groups
message keys
offsets
manual/controlled acknowledgement
retry handling
DLQ
5. Idempotency
This is mandatory.
Imagine:

POST /payments
Idempotency-Key: abc-123
The client sends it twice:
Request 1 → abc-123
Request 2 → abc-123
The system must not create two payments.
Expected:

Request 1 → creates payment
Request 2 → returns existing result
You should also handle the harder case:
Payment processed successfully
        ↓
Worker crashes before acknowledgement
        ↓
Kafka delivers message again
        ↓
Worker processes same payment again
Your system should recognize that the payment has already been processed.
This gives you a very good senior-level discussion around at-least-once delivery vs exactly-once business behavior.

6. Retry requirements
The payment provider should intentionally fail sometimes.
For example:

Attempt 1 → failure
Wait 1 sec
Attempt 2 → failure
Wait 2 sec
Attempt 3 → failure
Wait 4 sec
Attempt 4 → failure
→ DLQ
Use exponential backoff:
delay = baseDelay × 2^attempt
You should also introduce jitter so multiple workers don't retry simultaneously.
7. Dead-letter queue
After the maximum retry count:
payment.requested
        ↓
     Worker
        ↓
   failure
        ↓
     retry
        ↓
     retry
        ↓
     retry
        ↓
      DLQ
DLQ messages should contain useful information:
{
  "originalMessage": {},
  "error": "Payment provider timeout",
  "attempts": 4,
  "failedAt": "...",
  "service": "payment-worker"
}
You should also create an endpoint or small admin mechanism to reprocess a DLQ message.
8. Redis requirements
Use Redis for at least three real purposes.
A. Rate limiting
For example:
100 requests / minute / user
or:
1000 requests / minute / IP
Use Redis counters/TTL.
B. Caching
Cache frequently requested order/payment information.
Example:

GET /orders/123

API Gateway
     ↓
Order Service
     ↓
Redis
Cache miss:
Redis → miss
       ↓
PostgreSQL
       ↓
Redis SET
Use TTL.
C. Distributed coordination
You can optionally use Redis for a distributed lock where appropriate.
For example, preventing two workers from simultaneously performing a particular business operation.

Don't add Redis locks just for the sake of having them, though. You should be able to explain why you need one.

9. Authentication
Implement:
JWT authentication
Users should have something like:
userId
role
Roles:
CUSTOMER
ADMIN
Example:
Customer
  ↓
POST /orders

Admin
  ↓
GET /admin/dlq
POST /admin/dlq/:id/retry
10. Rate limiting
At minimum:
API Gateway
     ↓
Redis
     ↓
Rate limiter
Test scenarios such as:
100 requests → accepted
101st request → 429 Too Many Requests
Document the algorithm you choose.
For example:

Fixed window
Sliding window
Token bucket
I'd recommend token bucket or sliding window because they give you something meaningful to discuss in interviews.
11. API requirements
You don't need 50 endpoints.
Build a small but meaningful API.

Authentication
POST /auth/login
Orders
POST /orders
GET /orders/:id
GET /orders
POST /orders/:id/cancel
Payments
GET /payments/:id
POST /payments/:id/retry
Admin
GET /admin/dlq
POST /admin/dlq/:id/reprocess
12. External payment provider simulation
Don't integrate Stripe/Mollie initially.
Create:

Mock Payment Provider
It should simulate:
SUCCESS
TIMEOUT
5xx ERROR
RATE LIMIT
NETWORK ERROR
And ideally allow you to configure failure probability:
successRate = 90%
or:
successRate = 50%
This lets you demonstrate your retry and resilience mechanisms.
13. Observability
This is another area I particularly want you to build because it will differentiate the project from a normal CRUD portfolio project.
Structured logging
Every request should have:
requestId
correlationId
service
timestamp
level
message
Example:
{
  "level": "info",
  "service": "payment-worker",
  "correlationId": "req-123",
  "paymentId": "pay-456",
  "message": "Payment processing started"
}
Metrics
Track at least:
HTTP request count
HTTP error count
HTTP latency
Kafka messages processed
Kafka processing failures
Payment success rate
Payment failure rate
Retry count
DLQ count
PostgreSQL query latency
Redis latency
Monitoring stack
You can use:
Prometheus
Grafana
and optionally:
OpenTelemetry
for distributed tracing.
If OpenTelemetry becomes too much initially, add it after the core system works.

14. Health checks
Every service should expose:
GET /health
GET /ready
For example:
/health
→ process is alive

/ready
→ PostgreSQL available
→ Redis available
→ Kafka available
This becomes important when you deploy multiple instances.
15. Docker
Everything should run through Docker.
Your development environment should eventually be something like:

docker compose up
and bring up:
API Gateway
Order Service
Payment Service
Payment Worker
PostgreSQL
Redis
Kafka
Prometheus
Grafana
You don't want interviewers seeing:
"First install PostgreSQL, then Redis, then Kafka, then configure..."
Ideally:
docker compose up
and the whole system starts.
16. Horizontal scaling
This is important.
You should be able to run:

Order Service × 3

Payment Worker × 5
behind the gateway/load balancer.
For example:

                 ┌── Order Service #1
                 │
Client → Gateway ├── Order Service #2
                 │
                 └── Order Service #3
And:
                 ┌── Worker #1
Kafka ───────────┼── Worker #2
                 ├── Worker #3
                 ├── Worker #4
                 └── Worker #5
Kafka consumer groups should distribute partitions across workers.
17. Load testing
This is where your project starts becoming genuinely useful for your CV/interviews.
Use something like:

k6
Artillery
or another load-testing tool
Test:
Scenario 1 — normal load
500 requests/sec
Scenario 2 — high load
1,000 requests/sec
Scenario 3 — spike
100 → 2,000 requests/sec
Measure:
p50 latency
p95 latency
p99 latency
throughput
error rate
CPU
memory
database performance
Kafka lag
Don't invent numbers in your CV. Use whatever you actually measure.
18. Failure scenarios
This is one of the most important requirements.
You should deliberately break things.

Scenario A
Kill Payment Worker.
What happens?

Worker dies
↓
Kafka retains messages
↓
New worker starts
↓
Processing continues
Scenario B
Payment provider becomes unavailable.
Expected:

payment
↓
timeout
↓
retry
↓
retry
↓
retry
↓
DLQ
Scenario C
Database temporarily unavailable.
Observe:

service → DB failure
Your system shouldn't blindly retry database operations forever.
Scenario D
Redis unavailable.
Determine which functionality can degrade.

For example:

Cache unavailable
→ fall back to PostgreSQL
but perhaps:
Rate limiter unavailable
→ fail closed
or another deliberate policy.
The important thing is that you make the decision and document it.

Scenario E
Duplicate Kafka message.
Expected:

Message #1 → payment succeeds

Message #2 → recognized as duplicate
           → no second charge
This is a fantastic interview demonstration.
19. CI/CD
Use GitHub Actions.
Pipeline:

Push
 ↓
Lint
 ↓
Unit tests
 ↓
Integration tests
 ↓
Build Docker images
 ↓
Security/dependency checks
 ↓
Deploy
You don't need AWS initially.
Get the architecture working locally first.

Then deploy it somewhere inexpensive if practical.

20. Testing requirements
Don't only write controller tests.
Have:

Unit tests
Payment retry logic
Idempotency logic
Order state transitions
Rate limiting
Integration tests
Service + PostgreSQL
Service + Redis
Service + Kafka
End-to-end test
Something like:
Create order
     ↓
Payment requested
     ↓
Kafka
     ↓
Payment worker
     ↓
Mock provider
     ↓
Payment success
     ↓
Order becomes PAID
And:
Create order
↓
Provider fails
↓
Retries
↓
DLQ
↓
Admin reprocess
↓
Payment succeeds
21. Architecture documentation
This is not optional.
Your GitHub README should explain:

1. Problem
2. Requirements
3. Architecture
4. Service responsibilities
5. Database design
6. Kafka architecture
7. Idempotency strategy
8. Retry strategy
9. DLQ strategy
10. Rate limiting
11. Caching
12. Failure handling
13. Scaling strategy
14. Observability
15. Load-testing results
16. Trade-offs
17. What you would change at 10x scale
And include architecture diagrams.
22. Architecture diagram
Your final architecture should roughly look like:
                         ┌──────────────┐
                         │   Client     │
                         └──────┬───────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   API Gateway   │
                       │ Auth / RateLimit│
                       └───────┬─────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
             ┌─────────────┐       ┌──────────────┐
             │Order Service│       │Payment       │
             │             │       │Service       │
             └──────┬──────┘       └──────┬───────┘
                    │                     │
                    ▼                     ▼
              ┌───────────┐          ┌───────────┐
              │PostgreSQL │          │PostgreSQL │
              └───────────┘          └───────────┘

                    │
                    ▼
              ┌─────────────┐
              │    Kafka    │
              └──────┬──────┘
                     │
                     ▼
             ┌────────────────┐
             │ Payment Workers│
             │   × N          │
             └───────┬────────┘
                     │
                     ▼
             ┌─────────────────┐
             │ Mock Payment API│
             └─────────────────┘

              ┌────────────┐
              │   Redis    │
              │ Cache      │
              │ Rate Limit │
              └────────────┘

              ┌────────────┐
              │ Prometheus │
              └─────┬──────┘
                    ▼
               ┌─────────┐
               │ Grafana │
               └─────────┘
23. What NOT to build
This is important for you specifically.
Don't turn this into:

"I'm going to build an entire e-commerce platform."
You do not need:
product catalog
reviews
shopping cart
coupons
recommendation engine
shipping
inventory management
notifications
frontend
fancy UI
mobile app
Those will eat your time without teaching you the things we're targeting.
The project is about:

distributed backend engineering.

24. Recommended tech stack for you
Since your professional strength is Node.js, I would not make this a Python/Django project.
Use:

Language:       TypeScript
Framework:      NestJS
Database:       PostgreSQL
Cache:          Redis
Messaging:      Kafka
API Gateway:    NestJS initially
Auth:           JWT
Container:      Docker
Orchestration:  Docker Compose initially
CI/CD:          GitHub Actions
Metrics:        Prometheus
Dashboards:     Grafana
Tracing:        OpenTelemetry
Load testing:   k6
Testing:        Jest
This lets you spend your learning time on distributed systems, rather than fighting a language/framework you don't yet know well.
25. The actual definition of "done"
I would consider Version 1 complete only when you can demonstrate all of this:
A request comes in → authenticated → rate limited → order created → payment event published → Kafka distributes it → worker processes payment → provider fails → retry occurs → retries eventually succeed or message reaches DLQ → duplicate message doesn't charge twice → result is published → order becomes paid → metrics/logs show what happened → system can run multiple workers → load test demonstrates behavior under load.

And then you should be able to answer questions like:

Why Kafka?
Why asynchronous processing?
What happens if the worker crashes after charging the customer?
How do you prevent duplicate payments?
What happens if PostgreSQL goes down?
Why Redis?
Why did you choose this rate-limiting algorithm?
What happens when Kafka has 10,000 unprocessed messages?
How would you scale this to 10× the traffic?
What are the consistency guarantees?
Where can data be lost?
Where can messages be duplicated?
What happens when the payment provider times out but actually processed the payment?
That last category of questions is the real purpose of this project.
And given your current background, I would build it manually first for the core architecture, then use AI aggressively for implementation assistance, tests, debugging, documentation, and review. The point isn't to prove you can type every line of TypeScript; it's to make sure you understand every architectural decision well enough to defend it in an interview.
Wednesday 4:49 PM

payflow/
├── apps/
│   ├── api-gateway/
│   ├── order-service/
│   ├── payment-service/
│   └── payment-worker/
│
├── packages/
│   ├── shared-types/
│   ├── logger/
│   └── config/
│
├── infrastructure/
│   ├── docker/
│   ├── kafka/
│   ├── postgres/
│   ├── redis/
│   └── monitoring/
│
├── tests/
│   └── e2e/
│
├── docker-compose.yml
├── package.json
└── README.md

API Gateway
     ↓
Order Service ────── PostgreSQL
     ↓
   Kafka
     ↓
Payment Worker ───── Mock Provider
     ↑
Payment Service ──── PostgreSQL
        