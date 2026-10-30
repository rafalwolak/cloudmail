CREATE INDEX email_history_created_status_idx ON email_history (created_at, status);
CREATE INDEX delivery_events_occurred_type_idx ON delivery_events (occurred_at, type);
