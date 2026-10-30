import { saveCloudflareOAuthTokens } from './cloudflare-oauth-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { manageSelectedZoneDomains } from '../src/cloudflare-domain-management.ts';

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\'), (\'other\');');
  for (const file of ['0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  return { sqlite, prepare(sql) { return { bind(...args) { return { async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
}

test('domain operations require an administrator-selected zone and use its OAuth credentials', async () => {
  const db = await database(), secret = 's'.repeat(40), original = globalThis.fetch, zone = 'a'.repeat(32);
  const env = { DB: db, BETTER_AUTH_SECRET: secret, CLOUDFLARE_OAUTH_CLIENT_ID: 'client' };
  const request = () => new Request(`https://example.com/api/cloudflare/zones/${zone}/domains`);
  let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, `https://api.cloudflare.com/client/v4/zones/${zone}/email/sending/subdomains`); assert.equal(options.headers.authorization, 'Bearer access'); return Response.json({ success: true, result: [] }); };
  try {
    await saveCloudflareOAuthTokens(db, secret, 'admin', { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
    db.sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', zone, 'example.com', 'account');
    assert.equal((await manageSelectedZoneDomains(request(), env, 'other')).status, 404);
    assert.equal(calls, 0);
    assert.equal((await manageSelectedZoneDomains(request(), env, 'admin')).status, 200);
    assert.equal(calls, 1);
    const tag = 'b'.repeat(32);
    globalThis.fetch = async (url) => { assert.ok(url.endsWith(`/subdomains/${tag}/dns`)); return Response.json({ success: true, result: [] }); };
    const uppercase = new Request(`https://example.com/api/cloudflare/zones/${zone.toUpperCase()}/domains/${tag.toUpperCase()}/DNS`);
    assert.equal((await manageSelectedZoneDomains(uppercase, env, 'admin')).status, 200);
    assert.equal((await manageSelectedZoneDomains(request(), { ...env, CLOUDFLARE_OAUTH_CLIENT_ID: '' }, 'admin')).status, 503);
  } finally { globalThis.fetch = original; db.sqlite.close(); }
});

test('DNS diagnostics use only the selected zone and preserve incomplete results', async () => {
  const { checkSelectedDomainDns } = await import('../src/cloudflare-dns-diagnostics.ts');
  const db = await database(), secret = 's'.repeat(40), original = globalThis.fetch, zone = 'a'.repeat(32), tag = 'b'.repeat(32);
  const env = { DB: db, BETTER_AUTH_SECRET: secret, CLOUDFLARE_OAUTH_CLIENT_ID: 'client' };
  const request = () => new Request(`https://example.com/api/cloudflare/zones/${zone}/domains/${tag}/dns/check`);
  try {
    await saveCloudflareOAuthTokens(db, secret, 'admin', { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
    db.sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', zone, 'example.com', 'account');
    globalThis.fetch = async url => String(url).startsWith('https://api.cloudflare.com/')
      ? Response.json({ success: true, result: [{ type: 'TXT', name: 'example.com', content: 'v=spf1 -all' }], result_info: { total_count: 2 } })
      : Response.json({ Status: 0, Answer: [{ name: 'example.com.', type: 16, data: '"v=spf1 -all"' }] });
    assert.equal((await checkSelectedDomainDns(request(), env, 'other')).status, 404);
    const result = await (await checkSelectedDomainDns(request(), env, 'admin')).json();
    assert.equal(result.incomplete, true);
    assert.equal(result.data[0].status, 'match');
  } finally { globalThis.fetch = original; db.sqlite.close(); }
});
