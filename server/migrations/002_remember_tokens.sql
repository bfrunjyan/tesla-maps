-- "Remember this car": a long-lived, single-use token kept in the browser's local
-- storage. If the car's browser wipes cookies (power-down, energy saving), the app
-- trades this token for a new session and a new token.
CREATE TABLE remember_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX remember_tokens_user_idx ON remember_tokens (user_id);
