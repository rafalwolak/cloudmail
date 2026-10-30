CREATE TABLE cloudflare_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX cloudflare_oauth_states_expiry ON cloudflare_oauth_states(expires_at);
