DROP TRIGGER enqueue_delivery_event;
CREATE TABLE webhook_deliveries_new (
  id TEXT PRIMARY KEY NOT NULL,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES delivery_events(id),
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt TEXT NOT NULL,
  lease_until TEXT,
  last_status INTEGER,
  replay_of TEXT
);
INSERT INTO webhook_deliveries_new (id, webhook_id, event_id, state, attempts, next_attempt, lease_until, last_status)
SELECT id, webhook_id, event_id, state, attempts, next_attempt, lease_until, last_status FROM webhook_deliveries;
DROP TABLE webhook_deliveries;
ALTER TABLE webhook_deliveries_new RENAME TO webhook_deliveries;
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries(state, next_attempt);
CREATE UNIQUE INDEX webhook_deliveries_original_idx ON webhook_deliveries(webhook_id, event_id) WHERE replay_of IS NULL;
CREATE TRIGGER enqueue_delivery_event AFTER INSERT ON delivery_events BEGIN
  INSERT INTO webhook_deliveries (id, webhook_id, event_id, next_attempt)
  SELECT lower(hex(randomblob(16))), webhooks.id, NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM webhooks WHERE EXISTS (SELECT 1 FROM json_each(webhooks.events) WHERE value = 'email.' || NEW.type);
END;
