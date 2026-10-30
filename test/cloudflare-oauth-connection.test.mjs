import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { saveCloudflareOAuthTokens, readCloudflareOAuthTokens } from '../src/cloudflare-oauth-connection.ts';

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\'), (\'other\');');
  sqlite.exec(await readFile(new URL('../migrations/0026_cloudflare_oauth_connection.sql', import.meta.url), 'utf8'));
  return { sqlite, prepare(sql) { return { bind(...args) { return { async run() { return sqlite.prepare(sql).run(...args); }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
}

test('OAuth credentials are encrypted, authenticated, and bound to the administrator', async () => {
  const db = await database(); const secret = 'a'.repeat(40);
  const tokens = { accessToken: 'private-access-token', refreshToken: 'private-refresh-token', expiresAt: 12345 };
  try {
    assert.equal(await readCloudflareOAuthTokens(db, secret, 'admin'), null);
    await saveCloudflareOAuthTokens(db, secret, 'admin', tokens);
    const { ciphertext } = db.sqlite.prepare('SELECT ciphertext FROM cloudflare_oauth_connections WHERE user_id = ?').get('admin');
    assert.ok(!ciphertext.includes(tokens.accessToken) && !ciphertext.includes(tokens.refreshToken));
    assert.deepEqual(await readCloudflareOAuthTokens(db, secret, 'admin'), tokens);
    await assert.rejects(readCloudflareOAuthTokens(db, 'b'.repeat(40), 'admin'));
    db.sqlite.prepare('INSERT INTO cloudflare_oauth_connections (user_id, ciphertext) VALUES (?, ?)').run('other', ciphertext);
    await assert.rejects(readCloudflareOAuthTokens(db, secret, 'other'));
    await saveCloudflareOAuthTokens(db, secret, 'admin', tokens);
    assert.notEqual(db.sqlite.prepare('SELECT ciphertext FROM cloudflare_oauth_connections WHERE user_id = ?').get('admin').ciphertext, ciphertext);
    await assert.rejects(saveCloudflareOAuthTokens(db, secret, 'admin', { ...tokens, refreshToken: '' }));
    await assert.rejects(saveCloudflareOAuthTokens(db, secret, 'admin', { ...tokens, accessToken: 'x'.repeat(8193) }));
    await assert.rejects(saveCloudflareOAuthTokens(db, secret, 'admin', { ...tokens, expiresAt: 0 }));
  } finally { db.sqlite.close(); }
});
