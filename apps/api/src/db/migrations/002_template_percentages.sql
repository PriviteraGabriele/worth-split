ALTER TABLE templates
  ADD COLUMN allocation_mode text NOT NULL DEFAULT 'fixed'
  CHECK (allocation_mode IN ('fixed', 'percentage'));

ALTER TABLE template_items
  ALTER COLUMN amount_cents DROP NOT NULL,
  ADD COLUMN percentage_basis_points integer;

ALTER TABLE template_items
  ADD CONSTRAINT template_items_value_check CHECK (
    (amount_cents IS NOT NULL AND percentage_basis_points IS NULL)
    OR (amount_cents IS NULL AND percentage_basis_points BETWEEN 1 AND 10000)
  );
