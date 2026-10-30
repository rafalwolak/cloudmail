import { saveCloudflareOAuthTokens } from './cloudflare-oauth-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { manageCloudflareSuppressions } from '../src/cloudflare-suppressions.ts';

test('suppressions are scoped to a selected zone account and preserve pagination', async () => {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\');');
  for (const file of ['0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(sql) { return { bind(...args) { return { async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } }; } };
  const env = { DB: db, BETTER_AUTH_SECRET: 's'.repeat(40), CLOUDFLARE_OAUTH_CLIENT_ID: 'client' }, zone = 'a'.repeat(32), account = 'b'.repeat(32), original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url.pathname, `/client/v4/accounts/${account}/email/sending/suppressions`); assert.equal(url.searchParams.get('cursor'), 'opaque'); assert.equal(options.headers.authorization, 'Bearer access'); return Response.json({ success: true, result: [{ email: 'recipient@example.com', reason: 'hard_bounce', read_only: true }], result_info: { next_cursor: 'next' } }); };
  const request = () => new Request(`https://example.com/api/cloudflare/zones/${zone}/suppressions?cursor=opaque`);
  try {
    await saveCloudflareOAuthTokens(db, env.BETTER_AUTH_SECRET, 'admin', { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
    sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', zone, 'example.com', account);
    assert.equal((await manageCloudflareSuppressions(request(), env, 'other')).status, 404); assert.equal(calls, 0);
    const response = await manageCloudflareSuppressions(request(), env, 'admin'); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(body.next_cursor, 'next'); assert.equal(body.data[0].read_only, true);
    assert.equal((await manageCloudflareSuppressions(new Request(`https://example.com/api/cloudflare/zones/${zone}/suppressions?cursor=&cursor=again`), env, 'admin')).status, 400);
    const createRequest = payload => new Request(`https://example.com/api/cloudflare/zones/${zone}/suppressions`, { method: 'POST', body: JSON.stringify(payload) });
    assert.equal((await manageCloudflareSuppressions(createRequest({ email: 'recipient@example.com' }), env, 'admin')).status, 400);
    globalThis.fetch = async (_url, options) => { assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body).scope, { type: 'account' }); return Response.json({ success: true, result: { id: 'created', scope: { type: 'account' } } }); };
    const created = await manageCloudflareSuppressions(createRequest({ email: 'recipient@example.com', scope: { type: 'account' } }), env, 'admin');
    assert.equal(created.status, 201);
    const id = '12345678-1234-4234-8234-123456789abc';
    const remove = () => new Request(`https://example.com/api/cloudflare/zones/${zone}/suppressions/${id}`, { method: 'DELETE' });
    let deletes = 0;
    globalThis.fetch = async (_url, options) => { if (options.method === 'DELETE') deletes++; return Response.json({ success: true, result: { id, read_only: true } }); };
    assert.equal((await manageCloudflareSuppressions(remove(), env, 'admin')).status, 409); assert.equal(deletes, 0);
    globalThis.fetch = async (_url, options) => { if (options.method === 'DELETE') deletes++; return Response.json({ success: true, result: { id, read_only: false } }); };
    const deleted = await manageCloudflareSuppressions(remove(), env, 'admin'); assert.deepEqual(await deleted.json(), { id, deleted: true }); assert.equal(deletes, 1);
    globalThis.fetch = async () => Response.json({ success: true, result: { id } });
    assert.equal((await manageCloudflareSuppressions(remove(), env, 'admin')).status, 409);
    globalThis.fetch = async () => Response.json({ success: true, result: { id: 'different', read_only: false } });
    assert.equal((await manageCloudflareSuppressions(remove(), env, 'admin')).status, 502);



  } finally { globalThis.fetch = original; sqlite.close(); }
});
