-- Connect Tesla: one linked Tesla account per user. Tokens are stored encrypted
-- (server/lib/secretBox.ts); the last reading is kept so the level shows at once.
CREATE TABLE tesla_links (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  api_base text NOT NULL,
  cars jsonb NOT NULL DEFAULT '[]',
  vin text,
  reading jsonb,
  read_at timestamptz,
  reads_day date,
  reads_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
