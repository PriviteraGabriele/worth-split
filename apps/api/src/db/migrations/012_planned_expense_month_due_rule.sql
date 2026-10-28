ALTER TABLE planned_expenses
  DROP CONSTRAINT IF EXISTS planned_expenses_due_rule_check;

ALTER TABLE planned_expenses
  ADD CONSTRAINT planned_expenses_due_rule_check
  CHECK (due_rule IN ('month', 'exact', 'start', 'mid', 'end'));
