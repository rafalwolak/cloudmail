CREATE TABLE email_history (
  id TEXT PRIMARY KEY NOT NULL,
  sender TEXT NOT NULL,
  recipients TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'unknown')),
  provider_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX email_history_created_idx ON email_history (created_at DESC, id DESC);
