ALTER TABLE planned_expenses
  ADD COLUMN category text NOT NULL DEFAULT 'other'
  CHECK (category IN ('subscription','installment','one_time','other'));
