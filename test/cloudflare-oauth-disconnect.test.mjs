import { saveCloudflareOAuthTokens } from './cloudflare-oauth-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { readCloudflareOAuthTokens, replaceCloudflareOAuthConnection } from '../src/cloudflare-oauth-connection.ts';
import { disconnectCloudflare } from '../src/cloudflare-oauth-disconnect.ts';

test('disconnect revokes both credentials before removing the connection and selected zones', async () => {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\');');
  for (const file of ['0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }, prepare(sql) { return { bind(...args) { return { async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
  const secret = 's'.repeat(40), original = globalThis.fetch, tokens = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1000 }, calls = [];
  try {
    await saveCloudflareOAuthTokens(db, secret, 'admin', tokens);
    sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', 'a'.repeat(32), 'example.com', 'account');
    globalThis.fetch = async (url, options) => { assert.equal(url, 'https://dash.cloudflare.com/oauth2/revoke'); calls.push(options.body.get('token_type_hint')); assert.equal(options.redirect, 'manual'); return new Response(null, { status: calls.length === 1 ? 200 : 500 }); };
    await assert.rejects(disconnectCloudflare(db, secret, 'admin', 'client', 1000));
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM cloudflare_oauth_connections').get().count, 1);
    assert.equal(sqlite.prepare('SELECT refresh_owner FROM cloudflare_oauth_connections').get().refresh_owner, null);
    calls.length = 0;
    let continueRequest, onRequest;
    const pending = new Promise(resolve => { continueRequest = resolve; });
    const started = new Promise(resolve => { onRequest = resolve; });
    globalThis.fetch = async () => { onRequest(); await pending; return new Response(null, { status: 200 }); };
    const disconnected = disconnectCloudflare(db, secret, 'admin', 'client', 1000);
    await started;
    const replacement = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 2000 };
    await assert.rejects(replaceCloudflareOAuthConnection(db, secret, 'admin', replacement, 1000), /connection is busy/);
    assert.deepEqual(await readCloudflareOAuthTokens(db, secret, 'admin'), tokens);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM cloudflare_zones').get().count, 1);
    continueRequest();
    await disconnected;
    await saveCloudflareOAuthTokens(db, secret, 'admin', replacement);
    sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', 'a'.repeat(32), 'example.com', 'account');
    calls.length = 0;
    globalThis.fetch = async (_url, options) => { calls.push(options.body.get('token_type_hint')); return new Response(null, { status: 200 }); };
    await disconnectCloudflare(db, secret, 'admin', 'client', 1000);
    assert.deepEqual(calls, ['access_token', 'refresh_token']);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM cloudflare_oauth_connections').get().count, 0);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM cloudflare_zones').get().count, 0);
  } finally { globalThis.fetch = original; sqlite.close(); }
});
