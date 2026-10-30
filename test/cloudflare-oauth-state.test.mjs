import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createCloudflareOAuthState, consumeCloudflareOAuthState } from '../src/cloudflare-oauth-state.ts';

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0025_cloudflare_oauth_states.sql', '0028_cloudflare_oauth_session.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) { return { bind(...args) { return { async run() { return sqlite.prepare(sql).run(...args); }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; }
  };
}

test('OAuth state is random, bound to the administrator, PKCE-bound and single use', async () => {
  const db = await database();
  try {
    const first = await createCloudflareOAuthState(db, 'admin', 'session', 1000);
    const second = await createCloudflareOAuthState(db, 'admin', 'session', 1000);
    assert.notEqual(first.state, second.state);
    assert.equal(await consumeCloudflareOAuthState(db, first.state, 'other', 'session', 1001), null);
    assert.equal(await consumeCloudflareOAuthState(db, first.state, 'admin', 'other-session', 1001), null);
    const verifier = await consumeCloudflareOAuthState(db, first.state, 'admin', 'session', 1001);
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
    assert.equal(challenge, first.challenge);
    assert.equal(await consumeCloudflareOAuthState(db, first.state, 'admin', 'session', 1001), null);
    assert.equal(await consumeCloudflareOAuthState(db, 'invalid', 'admin', 'session', 1001), null);
    const stored = db.sqlite.prepare('SELECT state_hash FROM cloudflare_oauth_states').all();
    assert.ok(stored.every(row => row.state_hash !== second.state));
  } finally { db.sqlite.close(); }
});

test('expired states cannot be consumed and are removed when a new flow starts', async () => {
  const db = await database();
  try {
    const { state } = await createCloudflareOAuthState(db, 'admin', 'session', 1000);
    assert.equal(await consumeCloudflareOAuthState(db, state, 'admin', 'session', 601000), null);
    await createCloudflareOAuthState(db, 'admin', 'session', 601000);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS count FROM cloudflare_oauth_states').get().count, 1);
  } finally { db.sqlite.close(); }
});
