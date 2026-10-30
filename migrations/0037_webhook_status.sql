ALTER TABLE webhooks ADD COLUMN status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled'));
DROP TRIGGER enqueue_delivery_event;
CREATE TRIGGER enqueue_delivery_event AFTER INSERT ON delivery_events BEGIN
  INSERT INTO webhook_deliveries (id, webhook_id, event_id, next_attempt, event_type)
  SELECT lower(hex(randomblob(16))), webhooks.id, NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    CASE WHEN NEW.type = 'deferred' AND EXISTS (SELECT 1 FROM json_each(webhooks.events) WHERE value = 'email.delivery_delayed') THEN 'email.delivery_delayed' ELSE 'email.' || NEW.type END
  FROM webhooks WHERE status = 'enabled' AND EXISTS (SELECT 1 FROM json_each(webhooks.events) WHERE value = 'email.' || NEW.type OR (NEW.type = 'deferred' AND value = 'email.delivery_delayed'));
END;
