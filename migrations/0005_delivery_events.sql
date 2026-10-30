CREATE TABLE delivery_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX delivery_events_provider_idx ON delivery_events (provider_id, occurred_at, id);
