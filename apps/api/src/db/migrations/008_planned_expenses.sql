CREATE TABLE planned_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket_id uuid NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  amount_mode text NOT NULL CHECK (amount_mode IN ('fixed', 'estimated')),
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'once')),
  due_rule text NOT NULL CHECK (due_rule IN ('exact', 'start', 'mid', 'end')),
  due_day smallint CHECK (due_day BETWEEN 1 AND 31),
  due_date date,
  start_month date NOT NULL CHECK (start_month = date_trunc('month', start_month)::date),
  duration_months integer CHECK (duration_months IS NULL OR duration_months > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (frequency = 'monthly' AND due_date IS NULL)
    OR (frequency = 'once' AND duration_months IS NULL)
  ),
  CHECK (
    (due_rule = 'exact' AND frequency = 'monthly' AND due_day IS NOT NULL)
    OR (due_rule = 'exact' AND frequency = 'once' AND due_day IS NULL AND due_date IS NOT NULL)
    OR (due_rule IN ('start', 'mid', 'end') AND due_day IS NULL AND due_date IS NULL)
  ),
  CHECK (
    due_rule <> 'exact' OR frequency <> 'once'
    OR date_trunc('month', due_date)::date = start_month
  )
);
CREATE INDEX planned_expenses_user_active_idx
  ON planned_expenses(user_id, bucket_id, start_month)
  WHERE archived_at IS NULL;

CREATE TABLE planned_expense_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_expense_id uuid NOT NULL REFERENCES planned_expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period date NOT NULL CHECK (period = date_trunc('month', period)::date),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planned_expense_id, period),
  CHECK (
    (status = 'open' AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  )
);
CREATE INDEX planned_expense_occurrences_user_period_idx
  ON planned_expense_occurrences(user_id, period, status);

CREATE TABLE planned_expense_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES planned_expense_occurrences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  note text,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX planned_expense_payments_occurrence_idx
  ON planned_expense_payments(occurrence_id, created_at);
