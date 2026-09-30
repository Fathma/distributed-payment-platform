# Monitoring

Compose builds Prometheus with `prometheus.yml` copied into the image, avoiding a host file bind mount, and starts Grafana on host port 3004 (local development credentials: `admin` / `admin`). The scrape targets anticipate the service ports; application `/metrics` endpoints will be added with the observability phase.
