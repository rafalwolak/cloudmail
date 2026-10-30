ALTER TABLE email_history ADD COLUMN idempotency_key_hash TEXT;
ALTER TABLE email_history ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX email_history_idempotency_idx ON email_history (idempotency_key_hash);
