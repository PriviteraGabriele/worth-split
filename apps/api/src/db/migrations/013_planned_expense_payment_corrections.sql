ALTER TABLE planned_expense_payments
  DROP CONSTRAINT planned_expense_payments_amount_cents_check,
  ADD CONSTRAINT planned_expense_payments_amount_cents_nonzero_check CHECK (amount_cents <> 0);
