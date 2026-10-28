ALTER TABLE planned_expenses
  DROP CONSTRAINT IF EXISTS planned_expenses_frequency_check,
  DROP CONSTRAINT IF EXISTS planned_expenses_recurrence_check,
  DROP CONSTRAINT IF EXISTS planned_expenses_recurring_duration_check,
  DROP CONSTRAINT IF EXISTS planned_expenses_schedule_check;

ALTER TABLE planned_expenses
  ADD CONSTRAINT planned_expenses_frequency_check
    CHECK (frequency IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'once')),
  ADD CONSTRAINT planned_expenses_recurrence_check
    CHECK (
      (frequency IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual') AND due_date IS NULL)
      OR (frequency = 'once' AND duration_months IS NULL)
    ),
  ADD CONSTRAINT planned_expenses_recurring_duration_check
    CHECK (frequency = 'monthly' OR duration_months IS NULL),
  ADD CONSTRAINT planned_expenses_schedule_check
    CHECK (
      (due_rule = 'month' AND due_day IS NULL AND due_date IS NULL)
      OR (due_rule = 'exact' AND frequency IN ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual') AND due_day IS NOT NULL AND due_date IS NULL)
      OR (due_rule = 'exact' AND frequency = 'once' AND due_day IS NULL AND due_date IS NOT NULL
          AND date_trunc('month', due_date)::date = start_month)
      OR (due_rule IN ('start', 'mid', 'end') AND due_day IS NULL AND due_date IS NULL)
    );
