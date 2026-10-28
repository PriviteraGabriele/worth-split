-- Single-use links sent by e-mail to choose a password: an invitation for a
-- new account or a self-service reset. Only the SHA-256 digest of the token is
-- stored, as for sessions. A user has at most one pending link: issuing a new
-- one, or using it, deletes the others.
CREATE TABLE password_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('invite','reset')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_tokens_user_id_idx ON password_tokens(user_id);
