CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  items JSONB NOT NULL,
  total_amount BIGINT NOT NULL CHECK (total_amount > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'PAYMENT_FAILED', 'CANCELLED')),
  payment_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC);

CREATE TABLE order_idempotency_keys (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE order_outbox (
  event_id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX order_outbox_unpublished_idx ON order_outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE order_inbox (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
