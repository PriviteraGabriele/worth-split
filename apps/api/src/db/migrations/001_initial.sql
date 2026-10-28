CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text,
  totp_secret_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TYPE bucket_type AS ENUM ('spending', 'saving', 'investment', 'other');
CREATE TABLE buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  type bucket_type NOT NULL,
  balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'EUR',
  icon text NOT NULL,
  color text NOT NULL,
  monthly_target_cents bigint CHECK (monthly_target_cents IS NULL OR monthly_target_cents >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX buckets_active_name_idx ON buckets(user_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX buckets_user_sort_idx ON buckets(user_id, sort_order) WHERE archived_at IS NULL;

CREATE TYPE operation_kind AS ENUM ('adjustment', 'transfer', 'distribution');
CREATE TABLE operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind operation_kind NOT NULL,
  note text,
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX operations_user_occurred_idx ON operations(user_id, occurred_at DESC);

CREATE TABLE operation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  bucket_id uuid NOT NULL REFERENCES buckets(id),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0)
);
CREATE INDEX operation_entries_operation_idx ON operation_entries(operation_id);
CREATE INDEX operation_entries_bucket_idx ON operation_entries(bucket_id);

CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  bucket_id uuid NOT NULL REFERENCES buckets(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (template_id, bucket_id)
);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  currency char(3) NOT NULL DEFAULT 'EUR',
  locale text NOT NULL DEFAULT 'it-IT',
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  hide_amounts boolean NOT NULL DEFAULT false,
  quick_amounts_cents bigint[] NOT NULL DEFAULT ARRAY[5000,10000,15000,25000,45000]::bigint[],
  updated_at timestamptz NOT NULL DEFAULT now()
);
