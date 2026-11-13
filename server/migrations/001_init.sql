-- Accounts, sessions, sign-in codes, car pairing, and saved places.

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,              -- stored lowercased
  email_verified  boolean NOT NULL DEFAULT false,
  password_hash   text,                       -- null for code/Google-only accounts
  google_sub      text UNIQUE,
  name            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,         -- sha256 of the cookie token
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE email_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  code_hash    text NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_email_idx ON email_codes (email, created_at DESC);

-- QR sign-in: the car shows `code` (in a QR link); the phone approves it; the car
-- polls with a separate secret so knowing the link alone can't claim the session.
CREATE TABLE qr_pairings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  poll_token_hash  text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'claimed')),
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  user_agent       text,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE places (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('home', 'work', 'favorite', 'recent')),
  place_id    text NOT NULL,
  name        text NOT NULL,
  address     text NOT NULL DEFAULT '',
  lon         double precision NOT NULL,
  lat         double precision NOT NULL,
  category    text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX places_one_home_work ON places (user_id, kind) WHERE kind IN ('home', 'work');
CREATE UNIQUE INDEX places_unique_item ON places (user_id, kind, place_id) WHERE kind IN ('favorite', 'recent');
CREATE INDEX places_user_kind_idx ON places (user_id, kind, updated_at DESC);
