CREATE TABLE planned_expense_estimated_total_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_expense_id uuid NOT NULL REFERENCES planned_expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_month date NOT NULL CHECK (effective_month = date_trunc('month', effective_month)::date),
  included_in_estimated_total boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planned_expense_id, effective_month)
);

CREATE INDEX planned_expense_estimated_total_visibility_lookup_idx
  ON planned_expense_estimated_total_visibility(user_id, planned_expense_id, effective_month DESC);
