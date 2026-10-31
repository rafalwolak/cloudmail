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

test('delivery event inspection uses the selected account and verified domain metadata', async () => {
  const db = await database(), secret = 's'.repeat(40), original = globalThis.fetch;
  const zone = 'a'.repeat(32), account = 'b'.repeat(32), domainId = 'c'.repeat(32), queue = 'd'.repeat(32);
  const env = { DB: db, BETTER_AUTH_SECRET: secret, CLOUDFLARE_OAUTH_CLIENT_ID: 'client', DELIVERY_QUEUE_NAME: 'delivery' };
  const request = () => new Request(`https://example.com/api/cloudflare/zones/${zone}/domains/${domainId}/delivery-events`);
  let calls = 0; let denyQueue = 0; let denyCreate = 0;
  globalThis.fetch = async (input, options) => {
    calls++; const url = new URL(input);
    if (options.method === 'POST' && denyCreate) return new Response('private create diagnostic', { status: denyCreate });
    if (options.method === 'POST') return Response.json({ success: true, result: { id: 'subscription', ...JSON.parse(options.body) } });
    if (url.pathname.includes('/subdomains/')) return Response.json({ success: true, result: { name: 'mail.example.com', enabled: true } });
    assert.ok(url.pathname.startsWith(`/client/v4/accounts/${account}/`));
    if (denyQueue) return new Response('private upstream diagnostic', { status: denyQueue });
    const result = url.pathname.endsWith('/queues') ? [{ queue_name: 'delivery', queue_id: queue }] : [];
    return Response.json({ success: true, result, result_info: { page: 1, total_pages: 1, total_count: result.length } });
  };
  try {
    await saveCloudflareOAuthTokens(db, secret, 'admin', { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
    db.sqlite.prepare('INSERT INTO cloudflare_zones VALUES (?, ?, ?, ?)').run('admin', zone, 'example.com', account);
    assert.equal((await manageSelectedZoneDomains(request(), env, 'other')).status, 404); assert.equal(calls, 0);
    const result = await manageSelectedZoneDomains(request(), env, 'admin'); assert.equal(result.status, 200); assert.deepEqual(await result.json(), { action: 'missing' });
    db.sqlite.exec(await readFile(new URL('../migrations/0038_delivery_subscription_locks.sql', import.meta.url), 'utf8'));
    const created = await manageSelectedZoneDomains(new Request(request(), { method: 'POST' }), env, 'admin');
    assert.equal(created.status, 200); assert.deepEqual(await created.json(), { action: 'created', id: 'subscription' });
    for (const upstreamStatus of [401, 403]) {
      denyQueue = upstreamStatus;
      for (const method of ['GET', 'POST']) {
        const denied = await manageSelectedZoneDomains(new Request(request(), { method }), env, 'admin');
        assert.equal(denied.status, 502); const deniedBody = await denied.json();
        assert.equal(deniedBody.code, 'cloudflare_queue_access_required');
        assert.equal(denied.headers.get('cache-control'), 'no-store');
        assert.ok(!JSON.stringify(deniedBody).includes('private upstream diagnostic'));
      }
      denyQueue = 0; denyCreate = upstreamStatus;
      const denied = await manageSelectedZoneDomains(new Request(request(), { method: 'POST' }), env, 'admin');
      assert.equal(denied.status, 502); const deniedBody = await denied.json();
      assert.equal(deniedBody.code, 'cloudflare_queue_access_required');
      assert.ok(!JSON.stringify(deniedBody).includes('private create diagnostic'));
      assert.equal(db.sqlite.prepare('SELECT count(*) AS count FROM delivery_subscription_locks').get().count, 0);
      denyCreate = 0;
    }
    denyQueue = 500;
    const upstreamFailure = await manageSelectedZoneDomains(request(), env, 'admin');
    assert.equal(upstreamFailure.status, 502); assert.equal((await upstreamFailure.json()).code, undefined);
  } finally { globalThis.fetch = original; db.sqlite.close(); }
});

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
    globalThis.fetch = async (url, options) => { assert.ok(url.endsWith(`/subdomains/${tag}`)); assert.equal(options.method, 'PATCH'); assert.deepEqual(JSON.parse(options.body), { preview_enabled: false, drop_suppressed_recipients: true }); return Response.json({ success: true, result: { tag, enabled: true, name: 'example.com' } }); };
    const update = () => new Request(`https://example.com/api/cloudflare/zones/${zone}/domains/${tag}`, { method: 'PATCH', body: JSON.stringify({ preview_enabled: false, drop_suppressed_recipients: true }) });
    assert.equal((await manageSelectedZoneDomains(update(), env, 'other')).status, 404);
    assert.equal((await manageSelectedZoneDomains(update(), env, 'admin')).status, 200);
    for (const body of [{}, { preview_enabled: 'true' }, { enabled: true }]) {
      const invalid = new Request(`https://example.com/api/cloudflare/zones/${zone}/domains/${tag}`, { method: 'PATCH', body: JSON.stringify(body) });
      assert.equal((await manageSelectedZoneDomains(invalid, env, 'admin')).status, 400);
    }
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
