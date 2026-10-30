CREATE TABLE cloudflare_oauth_connections (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  refresh_owner TEXT,
  refresh_until INTEGER
);
