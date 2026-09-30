# Docker

The root `docker-compose.yml` starts PostgreSQL, Redis, Kafka, Prometheus, Grafana, and the four NestJS services. `infrastructure/docker/app.Dockerfile` builds the workspace and runs the selected app from a Node 22 image. Database bootstrap and Prometheus configuration are copied into derived images to avoid host file-sharing issues with this repository under `Documents`. Use `npm run apps:up` to build and start the app containers after infrastructure is up, or `docker compose up -d --build` for the entire stack.
