-- The publisher reads pending rows in created_at order. The ready index is
-- ordered by available_at first, so with a large backlog PostgreSQL had to
-- sort every pending row on each flush; this index lets it stop after the
-- batch.
CREATE INDEX operation_log_outbox_pending_created_idx
  ON operation_log_outbox (created_at)
  WHERE published_at IS NULL;
