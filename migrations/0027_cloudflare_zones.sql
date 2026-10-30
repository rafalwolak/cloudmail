CREATE TABLE cloudflare_zones (
  user_id TEXT NOT NULL REFERENCES cloudflare_oauth_connections(user_id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL,
  name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (user_id, zone_id)
);
