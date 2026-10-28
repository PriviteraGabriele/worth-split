-- Log of the backups each user downloaded, shown as "last backup" and
-- "recent exports" in settings. It only records metadata: the backup content
-- never leaves the export response. Rows belong to the account, so they are
-- neither part of a backup file nor removed by a data reset.
CREATE TABLE backup_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  protected boolean NOT NULL DEFAULT false,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  bucket_count integer NOT NULL CHECK (bucket_count >= 0),
  operation_count integer NOT NULL CHECK (operation_count >= 0),
  planned_expense_count integer NOT NULL CHECK (planned_expense_count >= 0),
  template_count integer NOT NULL CHECK (template_count >= 0)
);

CREATE INDEX backup_exports_user_created_idx ON backup_exports (user_id, created_at DESC);
