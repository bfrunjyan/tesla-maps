-- Last good charger snapshot (survives restarts when the upstream sources are down).
CREATE TABLE charger_cache (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

-- The car each driver chose (model, year, version). One per account.
CREATE TABLE vehicles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model       text NOT NULL,
  year        int NOT NULL CHECK (year BETWEEN 2008 AND 2100),
  trim        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
