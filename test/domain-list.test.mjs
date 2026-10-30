import { saveCloudflareOAuthTokens } from './cloudflare-oauth-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createDomain, deleteDomain, getDomain, listDomains } from '../src/domain-list.ts';

test('domain list reads selected zones without claiming DNS verification', async () => {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\');');
  for (const file of ['0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const db = { prepare(sql) { return { bind(...args) { return { async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; } }; } };
  const env = { DB: db, BETTER_AUTH_SECRET: 's'.repeat(40), CLOUDFLARE_OAUTH_CLIENT_ID: 'client' }, original = globalThis.fetch, zone = 'a'.repeat(32), tag = 'b'.repeat(32);
  globalThis.fetch = async (url, options) => { assert.ok(url.includes(`/zones/${zone}/`)); assert.equal(options.headers.authorization, 'Bearer access'); return Response.json({ success: true, result: [{ name: 'example.com', tag, enabled: true }], result_info: { total_pages: 1 } }); };
  try {
    await saveCloudflareOAuthTokens(db, env.BETTER_AUTH_SECRET, 'admin', { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
    sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', zone, 'example.com', 'account');
    const response = await listDomains(new Request('https://example.test/domains'), env, 'admin');
    assert.deepEqual(await response.json(), { object: 'list', data: [{ id: tag, name: 'example.com', status: 'unknown', zone_id: zone, enabled: true }], has_more: false });
    assert.equal((await listDomains(new Request('https://example.test/domains?limit=0'), env, 'admin')).status, 400);
    assert.equal((await listDomains(new Request('https://example.test/domains?after=missing'), env, 'admin')).status, 400);
    globalThis.fetch = async () => Response.json({ success: true, result: [{ name: 'one.example.com', tag: '1'.repeat(32), enabled: true }, { name: 'two.example.com', tag: '2'.repeat(32), enabled: true }], result_info: { total_pages: 1 } });
    const first = await (await listDomains(new Request('https://example.test/domains?limit=1'), env, 'admin')).json();
    assert.equal(first.data[0].id, '1'.repeat(32)); assert.equal(first.has_more, true);
    const second = await (await listDomains(new Request(`https://example.test/domains?limit=1&after=${first.data[0].id}`), env, 'admin')).json();
    assert.equal(second.data[0].id, '2'.repeat(32)); assert.equal(second.has_more, false);
    const previous = await (await listDomains(new Request(`https://example.test/domains?limit=1&before=${second.data[0].id}`), env, 'admin')).json();
    assert.equal(previous.data[0].id, '1'.repeat(32)); assert.equal(previous.has_more, false);
    globalThis.fetch = async () => Response.json({ success: true, result: [], result_info: { total_pages: 2 } });
    assert.equal((await listDomains(new Request('https://example.test/domains'), env, 'admin')).status, 502);

    const nested = 'c'.repeat(32); sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', nested, 'mail.example.com', 'account');
    globalThis.fetch = async (url, options) => { assert.ok(url.includes(`/zones/${nested}/`)); assert.deepEqual(JSON.parse(options.body), { name: 'sub.mail.example.com' }); return Response.json({ success: true, result: { tag, name: 'sub.mail.example.com', enabled: true } }); };
    const create = body => new Request('https://example.test/domains', { method: 'POST', body: JSON.stringify(body) });
    const created = await createDomain(create({ name: 'SUB.mail.example.com' }), env, 'admin');
    assert.equal(created.status, 200); assert.equal((await created.json()).zone_id, nested);
    assert.equal((await createDomain(create({ name: 'unrelated.test' }), env, 'admin')).status, 404);
    assert.equal((await createDomain(create({ name: 'example.com', region: 'us-east-1' }), env, 'admin')).status, 400);
    globalThis.fetch = async url => {
      if (url.includes(`/zones/${nested}/`)) return Response.json({ success: false }, { status: 404 });
      if (url.endsWith('/dns')) return Response.json({ success: true, result: [{ type: 'TXT', name: 'example.com', content: 'value' }], result_info: { total_pages: 2 } });
      return Response.json({ success: true, result: { tag, name: 'example.com', enabled: true } });
    };
    const get = () => new Request(`https://example.test/domains/${tag}`);
    const found = await getDomain(new Request(`https://example.test/domains/${tag.toUpperCase()}`), env, 'admin'); const detail = await found.json();
    assert.equal(found.status, 200); assert.equal(detail.status, 'unknown'); assert.equal(detail.records_incomplete, true); assert.equal(detail.records[0].type, 'TXT');
    globalThis.fetch = async () => Response.json({ success: true, result: { tag, name: 'example.com', enabled: true } });
    assert.equal((await getDomain(get(), env, 'admin')).status, 502);
    let deleteCalls = 0;
    assert.equal((await deleteDomain(new Request(`https://example.test/domains/${tag}`, { method: 'DELETE' }), env, 'admin')).status, 502);
    assert.equal(deleteCalls, 0);
    globalThis.fetch = async (url, options) => {
      if (options.method === 'DELETE') { deleteCalls++; assert.ok(url.includes(`/zones/${zone}/`)); return Response.json({ success: true }); }
      if (url.includes(`/zones/${nested}/`)) return Response.json({ success: false }, { status: 404 });
      if (url.endsWith('/dns')) return Response.json({ success: true, result: [] });
      return Response.json({ success: true, result: { tag, name: 'example.com', enabled: true } });
    };
    const removed = await deleteDomain(new Request(`https://example.test/domains/${tag}`, { method: 'DELETE' }), env, 'admin');
    assert.deepEqual(await removed.json(), { id: tag, deleted: true }); assert.equal(deleteCalls, 1);



  } finally { globalThis.fetch = original; sqlite.close(); }
});
