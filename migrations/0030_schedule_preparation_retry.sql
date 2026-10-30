ALTER TABLE scheduled_emails ADD COLUMN prepare_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scheduled_emails ADD COLUMN prepare_after TEXT;
CREATE INDEX scheduled_prepare_retry_idx ON scheduled_emails(state, prepare_after, scheduled_at);
