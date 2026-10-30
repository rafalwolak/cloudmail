CREATE TABLE scheduled_cleanup_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), cursor TEXT);
INSERT INTO scheduled_cleanup_cursor (id, cursor) VALUES (1, NULL);
CREATE INDEX scheduled_payload_r2_key_idx ON scheduled_emails (payload_r2_key);
