import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleCloudflareOAuth } from '../src/cloudflare-oauth-api.ts';
import { readCloudflareOAuthTokens } from '../src/cloudflare-oauth-connection.ts';

test('OAuth API starts PKCE and exchanges a callback once for the initiating administrator', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\');');
  for (const file of ['0025_cloudflare_oauth_states.sql', '0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { async batch(statements) { sqlite.exec('BEGIN'); try { for (const statement of statements) await statement.run(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }, prepare(sql) { return { bind(...args) { return { async run() { return sqlite.prepare(sql).run(...args); }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
  const env = { DB: db, BETTER_AUTH_SECRET: 's'.repeat(40), BETTER_AUTH_URL: 'https://cloudmail.example', CLOUDFLARE_OAUTH_CLIENT_ID: 'client' };
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => { calls++; assert.equal(options.body.get('redirect_uri'), 'https://cloudmail.example/api/cloudflare/oauth/callback'); return Response.json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 }); };
  try {
    sqlite.prepare('INSERT INTO cloudflare_oauth_connections (user_id, ciphertext) VALUES (?, ?)').run('admin', 'old');
    sqlite.prepare('INSERT INTO cloudflare_zones (user_id, zone_id, name, account_id) VALUES (?, ?, ?, ?)').run('admin', 'a'.repeat(32), 'old.example', 'old-account');
    const status = await handleCloudflareOAuth(new Request('https://cloudmail.example/api/cloudflare/oauth/status'), env, 'admin');
    assert.deepEqual(await status.json(), { configured: true, connected: true });
    const start = await handleCloudflareOAuth(new Request('https://cloudmail.example/api/cloudflare/oauth/start', { method: 'POST' }), env, 'admin');
    const url = new URL((await start.json()).authorization_url);
    assert.equal(url.searchParams.get('scope'), 'dns.write zone.read email-sending.read email-sending.write offline_access');
    const callback = () => new Request(`https://cloudmail.example/api/cloudflare/oauth/callback?state=${url.searchParams.get('state')}&code=code`);
    assert.equal((await handleCloudflareOAuth(callback(), env, 'other')).status, 400);
    const completed = await handleCloudflareOAuth(callback(), env, 'admin');
    assert.equal(completed.status, 303); assert.equal(completed.headers.get('location'), '/dashboard?cloudflare=connected');
    assert.equal((await readCloudflareOAuthTokens(db, env.BETTER_AUTH_SECRET, 'admin')).accessToken, 'access');
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM cloudflare_zones WHERE user_id = ?').get('admin').count, 0);
    assert.equal((await handleCloudflareOAuth(callback(), env, 'admin')).status, 400);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; sqlite.close(); }
});
