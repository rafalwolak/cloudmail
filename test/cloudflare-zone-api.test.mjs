import { saveCloudflareOAuthTokens } from './cloudflare-oauth-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleCloudflareZones } from '../src/cloudflare-zone-api.ts';

test('zone API lists and selects only Cloudflare-verified zones', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\');');
  for (const file of ['0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(sql) { return { bind(...args) { return { async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; } }; } };
  const env = { DB: db, BETTER_AUTH_SECRET: 's'.repeat(40), CLOUDFLARE_OAUTH_CLIENT_ID: 'client' };
  const original = globalThis.fetch, id = 'a'.repeat(32);
  globalThis.fetch = async (url) => String(url).includes('?') ? Response.json({ success: true, result: [{ id, name: 'example.com', status: 'active', account: { id: 'acct', name: 'Account' } }], result_info: { page: 1, total_pages: 1 } }) : Response.json({ success: true, result: { id, name: 'example.com', account: { id: 'acct' } } });
  const request = (path, options) => new Request(`https://example.com${path}`, options);
  try {
    await saveCloudflareOAuthTokens(db, env.BETTER_AUTH_SECRET, 'admin', { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
    const available = await handleCloudflareZones(request('/api/cloudflare/zones/available'), env, 'admin');
    assert.equal((await available.json()).data[0].id, id);
    assert.equal((await handleCloudflareZones(request('/api/cloudflare/zones/available?page=0'), env, 'admin')).status, 400);
    const selected = await handleCloudflareZones(request('/api/cloudflare/zones', { method: 'POST', body: JSON.stringify({ zone_id: id }) }), env, 'admin');
    assert.equal(selected.status, 201); assert.equal(selected.headers.get('cache-control'), 'no-store');
    assert.equal((await handleCloudflareZones(request('/api/cloudflare/zones?unexpected=1'), env, 'admin')).status, 400);
    const list = await handleCloudflareZones(request('/api/cloudflare/zones'), env, 'admin');
    assert.equal((await list.json()).data[0].id, id);
    assert.equal((await handleCloudflareZones(request('/api/cloudflare/zones', { method: 'POST', body: '{' }), env, 'admin')).status, 400);
  } finally { globalThis.fetch = original; sqlite.close(); }
});
