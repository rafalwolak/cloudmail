import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createCloudflareOAuthState } from '../src/cloudflare-oauth-state.ts';
import { readCloudflareOAuthTokens, saveCloudflareOAuthTokens } from '../src/cloudflare-oauth-connection.ts';
import { completeCloudflareAuthorization, refreshCloudflareTokens, refreshStoredCloudflareTokens } from '../src/cloudflare-oauth-token.ts';

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\');');
  for (const file of ['0025_cloudflare_oauth_states.sql', '0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql', '0028_cloudflare_oauth_session.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  return { sqlite, async batch(statements) { sqlite.exec('BEGIN'); try { for (const statement of statements) await statement.run(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }, prepare(sql) { return { bind(...args) { return { async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
}

test('authorization code exchange consumes state and stores encrypted credentials', async () => {
  const db = await database(), secret = 's'.repeat(40), original = globalThis.fetch;
  const { state, challenge } = await createCloudflareOAuthState(db, 'admin', 'session', 1000);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://dash.cloudflare.com/oauth2/token'); assert.equal(options.redirect, 'manual');
    assert.equal(options.body.get('code'), 'code'); assert.equal(options.body.get('redirect_uri'), 'https://example.com/callback');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body.get('code_verifier')));
    assert.equal(Buffer.from(digest).toString('base64url'), challenge);
    return Response.json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 60 });
  };
  try {
    await completeCloudflareAuthorization(db, secret, 'admin', 'session', 'client', 'https://example.com/callback', state, 'code', 1001);
    assert.deepEqual(await readCloudflareOAuthTokens(db, secret, 'admin'), { accessToken: 'access', refreshToken: 'refresh', expiresAt: 61001 });
    await assert.rejects(completeCloudflareAuthorization(db, secret, 'admin', 'session', 'client', 'https://example.com/callback', state, 'code', 1001));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; db.sqlite.close(); }
});

test('token endpoint errors are redacted and refresh handles rotated or unchanged refresh tokens', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error_description: 'private-refresh-token' }, { status: 400 });
    await assert.rejects(refreshCloudflareTokens('client', 'private-refresh-token', 1000), error => !error.message.includes('private-refresh-token'));
    globalThis.fetch = async (_url, options) => { assert.equal(options.body.get('grant_type'), 'refresh_token'); return Response.json({ access_token: 'new', token_type: 'bearer', expires_in: 60 }); };
    assert.deepEqual(await refreshCloudflareTokens('client', 'old', 1000), { accessToken: 'new', refreshToken: 'old', expiresAt: 61000 });
    globalThis.fetch = async () => Response.json({ access_token: 'new', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 60 });
    assert.equal((await refreshCloudflareTokens('client', 'old', 1000)).refreshToken, 'rotated');
    globalThis.fetch = async () => Response.json({ access_token: 'new', token_type: 'Bearer', expires_in: -1 });
    await assert.rejects(refreshCloudflareTokens('client', 'old', 1000));
  } finally { globalThis.fetch = original; }
});


test('only one concurrent request refreshes credentials and a failed refresh releases its lock', async () => {
  const db = await database(), secret = 's'.repeat(40), original = globalThis.fetch;
  let release, entered;
  const pending = new Promise(resolve => { release = resolve; });
  const called = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; entered(); await pending; return Response.json({ access_token: 'new', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 3600 }); };
  try {
    await saveCloudflareOAuthTokens(db, secret, 'admin', { accessToken: 'old', refreshToken: 'refresh', expiresAt: 1000 });
    const first = refreshStoredCloudflareTokens(db, secret, 'admin', 'client', 1000);
    await called;
    await assert.rejects(refreshStoredCloudflareTokens(db, secret, 'admin', 'client', 1000), /refresh is in progress/);
    release();
    assert.equal((await first).refreshToken, 'rotated');
    assert.equal((await refreshStoredCloudflareTokens(db, secret, 'admin', 'client', 1001)).accessToken, 'new');
    assert.equal(calls, 1);
    await saveCloudflareOAuthTokens(db, secret, 'admin', { accessToken: 'old', refreshToken: 'refresh', expiresAt: 1000 });
    globalThis.fetch = async () => new Response('', { status: 400 });
    await assert.rejects(refreshStoredCloudflareTokens(db, secret, 'admin', 'client', 1000));
    assert.equal(db.sqlite.prepare('SELECT refresh_owner FROM cloudflare_oauth_connections').get().refresh_owner, null);
  } finally { globalThis.fetch = original; db.sqlite.close(); }
});
