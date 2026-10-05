#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

order_replicas="$(docker compose ps -q order-service | wc -l | tr -d ' ')"
worker_replicas="$(docker compose ps -q payment-worker | wc -l | tr -d ' ')"
if [[ "$order_replicas" -lt 1 || "$worker_replicas" -lt 1 ]]; then
  echo 'Start the PayFlow Compose stack before running the scaling check.' >&2
  exit 1
fi

restore_replicas() {
  docker compose up -d --scale "order-service=$order_replicas" --scale "payment-worker=$worker_replicas" order-service payment-worker >/dev/null
}
trap restore_replicas EXIT INT TERM

docker compose up -d --scale order-service=2 --scale payment-worker=2 order-service payment-worker

wait_for_replicas() {
  local service="$1" expected="$2" deadline=$((SECONDS + 90)) count
  while (( SECONDS < deadline )); do
    count="$(docker compose ps --status running -q "$service" | wc -l | tr -d ' ')"
    if [[ "$count" -eq "$expected" ]]; then return 0; fi
    sleep 2
  done
  echo "$service did not reach $expected running replicas" >&2
  docker compose ps "$service" >&2
  return 1
}

wait_for_replicas order-service 2
wait_for_replicas payment-worker 2

echo 'Order Service replicas:'
docker compose ps order-service
echo 'Payment Worker replicas:'
docker compose ps payment-worker

echo 'Generating concurrent gateway traffic for Order Service replicas:'
probe_output="$(node tests/scale/send-distributed-orders.mjs)"
printf '%s\n' "$probe_output"
probe_ids="${probe_output##*scale_probe_order_ids=}"
if [[ "$probe_ids" == "$probe_output" ]]; then
  echo 'Scale probe did not return its created order IDs.' >&2
  exit 1
fi

deadline=$((SECONDS + 30))
while (( SECONDS < deadline )); do
  distributed=0
  for container in $(docker compose ps -q order-service); do
    logs="$(docker logs --since 2m "$container" 2>&1 || true)"
    for order_id in ${probe_ids//,/ }; do
      if grep -Fq "$order_id" <<< "$logs"; then ((distributed += 1)); break; fi
    done
  done
  if [[ "$distributed" -eq 2 ]]; then break; fi
  sleep 2
done
if [[ "$distributed" -lt 2 ]]; then
  echo 'Concurrent gateway traffic did not reach both Order Service replicas.' >&2
  exit 1
fi

echo 'Payment Worker Kafka group assignments:'
members="$(docker compose exec -T kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 --describe --group payment-worker-v1 --members --verbose)"
printf '%s\n' "$members"
active_members="$(printf '%s\n' "$members" | awk 'NR > 1 && $1 == "payment-worker-v1" { seen[$2] = 1 } END { for (member in seen) count++; print count+0 }')"
if [[ "$active_members" -lt 2 ]]; then
  echo "Expected two payment-worker-v1 group members, found $active_members" >&2
  exit 1
fi

echo 'Scaling check passed; original replica counts will be restored on exit.'
