#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"
mkdir -p tests/results
output="${1:-tests/results/phase7-$(date -u +%Y%m%dT%H%M%SZ).txt}"

{
  echo "Captured at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo '=== Compose services ==='
  docker compose ps
  echo
  echo '=== Container CPU and memory ==='
  docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
  echo
  echo '=== PostgreSQL database counters ==='
  docker compose exec -T postgres psql -U postgres -d postgres -Atc \
    "SELECT datname || ' xact_commit=' || xact_commit || ' xact_rollback=' || xact_rollback || ' blks_read=' || blks_read || ' blks_hit=' || blks_hit FROM pg_stat_database WHERE datname IN ('order_db','payment_db','worker_db') ORDER BY datname"
  echo
  echo '=== Prometheus snapshots ==='
  for query in \
    'sum(rate(payflow_http_requests_total[5m])) by (service)' \
    'histogram_quantile(0.50,sum(rate(payflow_http_request_duration_seconds_bucket[5m])) by (service,le))' \
    'histogram_quantile(0.95,sum(rate(payflow_http_request_duration_seconds_bucket[5m])) by (service,le))' \
    'histogram_quantile(0.99,sum(rate(payflow_http_request_duration_seconds_bucket[5m])) by (service,le))' \
    'sum(rate(payflow_http_requests_total{status_code=~"5.."}[5m])) by (service)' \
    'sum(payflow_kafka_consumer_lag) by (group,topic)' \
    'sum(rate(payflow_payment_outcomes_total[5m])) by (outcome)' \
    'sum(rate(payflow_payment_retries_total[5m])) by (failure_code)' \
    'sum(rate(payflow_dlq_messages_total[5m])) by (action)'; do
    echo "query: $query"
    curl --fail --silent --show-error --get 'http://localhost:9090/api/v1/query' --data-urlencode "query=$query"
    echo
  done
} | tee "$output"

echo "Runtime snapshot saved to $output"
