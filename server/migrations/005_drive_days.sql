-- Driving history: totals per day, never GPS tracks. Each device keeps its own log
-- (log_id, new whenever a device starts a fresh log) and sends that log's running
-- totals for each day; the account's day is the sum of its logs. So two cars, or a
-- retried request, never double-count.
CREATE TABLE drive_days (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_id      uuid NOT NULL,
  day         date NOT NULL,
  metres      int NOT NULL CHECK (metres >= 0),
  wh          int NOT NULL CHECK (wh >= 0),
  seconds     int NOT NULL CHECK (seconds >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, log_id, day)
);
CREATE INDEX drive_days_user_day ON drive_days (user_id, day);
