ALTER TABLE api_keys ADD COLUMN permission TEXT NOT NULL DEFAULT 'full_access' CHECK (permission IN ('full_access', 'sending_access'));
