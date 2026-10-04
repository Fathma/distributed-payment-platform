CREATE TABLE IF NOT EXISTS worker_jobs (
  event_id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  original_event JSONB NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_jobs_ready_idx ON worker_jobs (available_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS provider_outcomes (
  idempotency_key TEXT PRIMARY KEY,
  provider_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_dlq (
  dlq_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL,
  original_event JSONB NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reprocessed_at TIMESTAMPTZ,
  reprocessed_by TEXT
);
