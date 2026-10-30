CREATE TABLE webhook_attempts (
  delivery_id TEXT NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  attempted_at TEXT NOT NULL,
  status INTEGER,
  error TEXT,
  PRIMARY KEY (delivery_id, attempt_number)
);
