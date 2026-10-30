CREATE TABLE webhooks (
  id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL,
  events TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES delivery_events(id),
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt TEXT NOT NULL,
  lease_until TEXT,
  last_status INTEGER,
  UNIQUE(webhook_id, event_id)
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries(state, next_attempt);
CREATE TRIGGER enqueue_delivery_event AFTER INSERT ON delivery_events BEGIN
  INSERT INTO webhook_deliveries (id, webhook_id, event_id, next_attempt)
  SELECT lower(hex(randomblob(16))), webhooks.id, NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM webhooks WHERE EXISTS (SELECT 1 FROM json_each(webhooks.events) WHERE value = 'email.' || NEW.type);
END;
