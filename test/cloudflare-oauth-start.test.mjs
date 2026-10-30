import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { startCloudflareAuthorization } from '../src/cloudflare-oauth-start.ts';
import { consumeCloudflareOAuthState } from '../src/cloudflare-oauth-state.ts';

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0025_cloudflare_oauth_states.sql', '0028_cloudflare_oauth_session.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  return { sqlite, prepare(sql) { return { bind(...args) { return { async run() { return sqlite.prepare(sql).run(...args); }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
}

test('authorization request uses the registered callback, requested scopes and PKCE', async () => {
  const db = await database();
  try {
    const url = new URL(await startCloudflareAuthorization(db, 'admin', 'session', { clientId: 'client', redirectUri: 'https://example.com/callback', scopes: ['email-sending.write', 'zone.read'] }, 1000));
    assert.equal(url.origin + url.pathname, 'https://dash.cloudflare.com/oauth2/auth');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/callback');
    assert.equal(url.searchParams.get('scope'), 'email-sending.write zone.read offline_access');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const verifier = await consumeCloudflareOAuthState(db, url.searchParams.get('state'), 'admin', 'session', 1001);
    assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url'), url.searchParams.get('code_challenge'));
  } finally { db.sqlite.close(); }
});

test('invalid client configuration is rejected before creating state', async () => {
  const db = await database();
  try {
    for (const config of [
      { clientId: '', redirectUri: 'https://example.com/callback', scopes: ['zone.read'] },
      { clientId: 'client', redirectUri: 'http://example.com/callback', scopes: ['zone.read'] },
      { clientId: 'client', redirectUri: 'https://example.com/callback#fragment', scopes: ['zone.read'] },
      { clientId: 'client', redirectUri: 'https://example.com/callback', scopes: ['email_sending:write'] },
    ]) await assert.rejects(startCloudflareAuthorization(db, 'admin', 'session', config, 1000));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS count FROM cloudflare_oauth_states').get().count, 0);
  } finally { db.sqlite.close(); }
});
