ALTER TABLE planned_expenses
  DROP CONSTRAINT IF EXISTS planned_expenses_check1,
  DROP CONSTRAINT IF EXISTS planned_expenses_check2;

ALTER TABLE planned_expenses
  ADD CONSTRAINT planned_expenses_schedule_check CHECK (
    (due_rule = 'month' AND due_day IS NULL AND due_date IS NULL)
    OR (due_rule = 'exact' AND frequency = 'monthly' AND due_day IS NOT NULL AND due_date IS NULL)
    OR (due_rule = 'exact' AND frequency = 'once' AND due_day IS NULL AND due_date IS NOT NULL
        AND date_trunc('month', due_date)::date = start_month)
    OR (due_rule IN ('start', 'mid', 'end') AND due_day IS NULL AND due_date IS NULL)
  );
