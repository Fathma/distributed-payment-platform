# PostgreSQL

The Compose PostgreSQL image copies `init.sql` into the image, avoiding a host file bind mount. It initializes separate `order_db` and `payment_db` databases and service-specific development users. The schema migrations live with their owning services in `apps/order-service/migrations` and `apps/payment-service/migrations`. Apply them with the service workspace's `db:migrate` script after copying `.env.example` to `.env` and starting Compose. The init script runs only when the PostgreSQL data volume is first created.
