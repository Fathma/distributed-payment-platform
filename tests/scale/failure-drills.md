# Phase 7 failure drills

Run these only against the local development Compose stack. Keep a terminal open
for `docker compose ps` and another for Prometheus/Grafana. Each drill includes a
recovery step; allow health checks to settle before continuing.

## Worker interruption and provider outage

1. Start a normal k6 run (`K6_PROFILE=normal k6 run tests/load/payment-flow.js`).
2. Stop the worker with `docker compose stop payment-worker`. New requests should
   remain pending while the `payment-worker-v1` Kafka lag grows.
3. Restore it with `docker compose start payment-worker`; pending work should
   drain and orders should reach terminal states.
4. Simulate provider unavailability with
   `MOCK_PROVIDER_MODE=network_error docker compose up -d --no-deps --force-recreate payment-worker`.
   Requests should exhaust bounded retries and enter the DLQ. Restore the provider
   with `MOCK_PROVIDER_MODE=success docker compose up -d --no-deps --force-recreate payment-worker`.
   Use the admin DLQ reprocess endpoint to recover an affected payment.

## PostgreSQL, Redis, and Kafka interruption

- PostgreSQL: `docker compose stop postgres`, verify `/ready` becomes not ready
  and payment work remains unacknowledged, then `docker compose start postgres`.
- Redis: `docker compose stop redis`, verify gateway readiness fails and guarded
  requests fail closed, then `docker compose start redis`.
- Kafka: `docker compose stop kafka`, verify broker-dependent readiness fails,
  then `docker compose start kafka`; allow consumers and outbox relays to reconnect.

These interruptions affect every service attached to the dependency. Do not use
them against shared or production infrastructure.

## Duplicate delivery

`npm run test:e2e` republishes a captured `payment.requested` event and checks that
the provider records exactly one outcome for its idempotency key.
