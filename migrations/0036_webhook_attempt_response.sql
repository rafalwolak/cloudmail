ALTER TABLE webhook_attempts ADD COLUMN response TEXT;
ALTER TABLE webhook_attempts ADD COLUMN response_truncated INTEGER NOT NULL DEFAULT 0;
