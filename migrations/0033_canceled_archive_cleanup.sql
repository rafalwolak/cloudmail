ALTER TABLE scheduled_emails ADD COLUMN archive_cleanup_pending INTEGER NOT NULL DEFAULT 0;
UPDATE scheduled_emails SET archive_cleanup_pending = 1 WHERE state = 'canceled';
CREATE INDEX scheduled_canceled_archive_cleanup_idx ON scheduled_emails (id) WHERE state = 'canceled' AND archive_cleanup_pending = 1;
