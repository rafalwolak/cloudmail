CREATE TABLE scheduled_emails (
  id TEXT PRIMARY KEY REFERENCES email_history(id),
  scheduled_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'sending', 'accepted', 'unknown', 'canceled')),
  payload TEXT
);
CREATE INDEX scheduled_emails_due_idx ON scheduled_emails(state, scheduled_at);
