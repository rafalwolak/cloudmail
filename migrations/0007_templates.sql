CREATE TABLE templates (
  id TEXT PRIMARY KEY NOT NULL,
  draft TEXT NOT NULL,
  published TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX templates_created_idx ON templates (created_at DESC, id DESC);
