ALTER TABLE webhooks ADD COLUMN previous_secret TEXT;
ALTER TABLE webhooks ADD COLUMN previous_secret_expires_at TEXT;
