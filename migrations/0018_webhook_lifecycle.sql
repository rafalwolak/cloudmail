CREATE TRIGGER enqueue_email_sent AFTER UPDATE OF status ON email_history
WHEN NEW.status = 'accepted' AND OLD.status <> 'accepted' AND NEW.provider_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM webhooks, json_each(webhooks.events) WHERE value = 'email.sent')
BEGIN
  INSERT OR IGNORE INTO delivery_events (id, provider_id, recipient, type, occurred_at, details)
  VALUES ('sent:' || NEW.id, NEW.provider_id, json_extract(NEW.recipients, '$[0]'), 'sent', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '{}');
END;
CREATE TRIGGER enqueue_email_received AFTER INSERT ON inbound_emails
WHEN EXISTS (SELECT 1 FROM webhooks, json_each(webhooks.events) WHERE value = 'email.received')
BEGIN
  INSERT OR IGNORE INTO delivery_events (id, provider_id, recipient, type, occurred_at, details)
  VALUES ('received:' || NEW.id, 'inbound:' || NEW.id, NEW.recipient, 'received', NEW.created_at, '{}');
END;
CREATE TRIGGER remove_received_webhook_data AFTER DELETE ON inbound_emails BEGIN
  DELETE FROM webhook_deliveries WHERE event_id = 'received:' || OLD.id;
  DELETE FROM delivery_events WHERE id = 'received:' || OLD.id;
END;
