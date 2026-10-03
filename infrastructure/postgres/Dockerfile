FROM postgres:16-alpine

COPY infrastructure/postgres/init.sql /docker-entrypoint-initdb.d/001-init.sql
COPY apps/order-service/migrations/001_initial.sql /migrations/order/001_initial.sql
COPY apps/payment-service/migrations/001_initial.sql /migrations/payment/001_initial.sql
