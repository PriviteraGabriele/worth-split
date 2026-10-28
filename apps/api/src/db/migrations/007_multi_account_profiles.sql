ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin')),
  ADD COLUMN first_name text,
  ADD COLUMN last_name text,
  ADD COLUMN gender text
    CHECK (gender IS NULL OR gender IN ('male', 'female')),
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- Worth Split was single-user before this migration: preserve that account and
-- grant it administration capabilities in addition to its normal data access.
UPDATE users
SET role = 'admin', updated_at = now()
WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1);

CREATE INDEX users_role_idx ON users(role);
CREATE INDEX users_active_idx ON users(is_active);
