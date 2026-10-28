ALTER TABLE planned_expenses
  ADD COLUMN description text
  CHECK (description IS NULL OR char_length(btrim(description)) BETWEEN 1 AND 300);
