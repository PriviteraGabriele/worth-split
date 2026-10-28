-- Reliable hand-off for observability events. The operational log itself is
-- stored in Elasticsearch; this table only retains rows until publication and
-- for a short post-publication troubleshooting window.
CREATE TABLE operation_log_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  published_at timestamptz,
  last_error text
);

CREATE INDEX operation_log_outbox_ready_idx
  ON operation_log_outbox (available_at, created_at)
  WHERE published_at IS NULL;

CREATE INDEX operation_log_outbox_published_idx
  ON operation_log_outbox (published_at)
  WHERE published_at IS NOT NULL;
