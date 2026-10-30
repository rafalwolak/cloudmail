CREATE TABLE inbound_emails (
  id TEXT PRIMARY KEY NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE
);
CREATE INDEX inbound_emails_created_idx ON inbound_emails (created_at DESC, id DESC);
