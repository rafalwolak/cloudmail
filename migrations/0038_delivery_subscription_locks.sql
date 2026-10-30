CREATE TABLE delivery_subscription_locks (
  target TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
