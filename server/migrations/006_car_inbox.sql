-- "Send to car": the last place the driver sent from their phone, waiting for the car.
-- One per account; a newer one replaces it. delivered_at is set once the car shows it.
CREATE TABLE car_inbox (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  place         jsonb NOT NULL,
  -- The sending device, so it doesn't offer the place back to itself.
  from_device   text,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz
);
