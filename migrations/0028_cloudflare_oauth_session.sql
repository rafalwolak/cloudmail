ALTER TABLE cloudflare_oauth_states ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
DELETE FROM cloudflare_oauth_states;
