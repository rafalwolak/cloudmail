CREATE TABLE batch_requests (
  id TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'uncertain')),
  results TEXT,
  created_at TEXT NOT NULL
);
