import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivedRawDownload, downloadReceivedRaw } from '../src/received-raw.ts';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const now = Date.UTC(2026, 9, 31);
function fixture() {
  const content = new TextEncoder().encode('MIME-Version: 1.0\r\n\r\nSynthetic raw MIME\r\n');
  const reads = [];
  const row = { object_key: `inbound/${id}` };
  const env = {
    BETTER_AUTH_SECRET: 'synthetic-local-signing-secret-with-at-least-32-characters',
    BETTER_AUTH_URL: 'https://mail.example.net', ADMIN_EMAIL: 'admin@example.net',
    DB: { prepare(sql) { reads.push('db'); assert.match(sql, /inbound_emails/); return { bind(value) { assert.equal(value, id); return { first: async () => row }; } }; } },
    INBOUND: {
      async get(key) { reads.push('get'); assert.equal(key, `inbound/${id}`); return { size: content.length, body: new Blob([content]).stream(), arrayBuffer() { throw new Error('Raw downloads must stream'); } }; },
      async head(key) { reads.push('head'); assert.equal(key, `inbound/${id}`); return { size: content.length }; },
    },
  };
  return { env, content, reads };
}
function checkPrivateHeaders(response) {
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}

test('signed raw MIME download streams the original bytes and HEAD reads only object metadata', async () => {
  const { env, content, reads } = fixture();
  const raw = await createReceivedRawDownload(id, env, now);
  assert.equal(new URL(raw.download_url).origin, env.BETTER_AUTH_URL);
  assert.equal(Date.parse(raw.expires_at), now + 5 * 60 * 1000);
  assert.deepEqual(reads, []);
  const response = await downloadReceivedRaw(new Request(raw.download_url), env, now);
  assert.equal(response.status, 200); checkPrivateHeaders(response);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="${id}.eml"`);
  assert.equal(response.headers.get('content-length'), String(content.length));
  assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), Buffer.from(content)), 0);
  reads.length = 0;
  const head = await downloadReceivedRaw(new Request(raw.download_url, { method: 'HEAD' }), env, now);
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); checkPrivateHeaders(head);
  assert.deepEqual(reads, ['db', 'head']);
});

test('raw links reject tampering, expiry, changed installation context and unsupported queries before storage access', async () => {
  const { env, reads } = fixture();
  const raw = await createReceivedRawDownload(id, env, now);
  const mutations = [
    url => { url.searchParams.delete('signature'); },
    url => { const value = url.searchParams.get('signature'); url.searchParams.set('signature', `${value[0] === '0' ? '1' : '0'}${value.slice(1)}`); },
    url => { url.searchParams.set('signature', '0'.repeat(63)); },
    url => { url.searchParams.set('expires', String(now / 1000 + 301)); },
    url => { url.searchParams.set('expires', '1e10'); },
    url => { url.searchParams.append('expires', url.searchParams.get('expires')); },
    url => { url.searchParams.append('signature', url.searchParams.get('signature')); },
    url => { url.searchParams.set('extra', 'value'); },
    url => { url.pathname = url.pathname.replace(id, otherId); },
    url => { url.hostname = 'other.example.net'; },
  ];
  for (const mutate of mutations) {
    const url = new URL(raw.download_url); mutate(url);
    const response = await downloadReceivedRaw(new Request(url), env, now);
    assert.equal(response.status, 403); checkPrivateHeaders(response);
  }
  for (const delta of [5 * 60 * 1000, 5 * 60 * 1000 + 1]) assert.equal((await downloadReceivedRaw(new Request(raw.download_url), env, now + delta)).status, 403);
  for (const changes of [{ BETTER_AUTH_SECRET: 'another-synthetic-secret-longer-than-32-characters' }, { ADMIN_EMAIL: 'replacement@example.net' }, { BETTER_AUTH_URL: 'https://other.example.net' }]) {
    assert.equal((await downloadReceivedRaw(new Request(raw.download_url), { ...env, ...changes }, now)).status, 403);
  }
  const future = await createReceivedRawDownload(id, env, now + 1000);
  assert.equal((await downloadReceivedRaw(new Request(future.download_url), env, now)).status, 403);
  assert.deepEqual(reads, []);
});

test('raw downloads fail closed when configuration, records or content are unavailable and reject writes', async () => {
  const { env, reads } = fixture();
  const raw = await createReceivedRawDownload(id, env, now);
  for (const changes of [{ BETTER_AUTH_SECRET: '' }, { BETTER_AUTH_SECRET: 'replace-with-a-unique-random-secret' }, { BETTER_AUTH_URL: 'http://public.example.net' }]) {
    assert.equal(await createReceivedRawDownload(id, { ...env, ...changes }, now), null);
    assert.equal((await downloadReceivedRaw(new Request(raw.download_url), { ...env, ...changes }, now)).status, 403);
  }
  assert.equal(await createReceivedRawDownload('../sent/message', env, now), null);
  const denied = await downloadReceivedRaw(new Request(raw.download_url, { method: 'POST' }), env, now);
  assert.equal(denied.status, 405); assert.equal(denied.headers.get('allow'), 'GET, HEAD'); assert.deepEqual(reads, []);
  const missing = { ...env, DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  assert.equal((await downloadReceivedRaw(new Request(raw.download_url), missing, now)).status, 404);
  assert.equal((await downloadReceivedRaw(new Request(raw.download_url), { ...env, INBOUND: { get: async () => null } }, now)).status, 503);
  assert.equal((await downloadReceivedRaw(new Request(raw.download_url), { ...env, INBOUND: { get: async () => { throw new Error('Storage unavailable'); } } }, now)).status, 503);
});

test('raw signatures issued before the shared signer refactor remain valid', async () => {
  const { createHmac } = await import('node:crypto');
  const { env } = fixture(); const expires = now / 1000 + 300;
  const signature = createHmac('sha256', env.BETTER_AUTH_SECRET).update(JSON.stringify(['cloudmail:received-raw:v1', env.BETTER_AUTH_URL, env.ADMIN_EMAIL, id, expires])).digest('hex');
  const url = new URL(`/downloads/receiving/${id}/raw`, env.BETTER_AUTH_URL);
  url.searchParams.set('expires', String(expires)); url.searchParams.set('signature', signature);
  assert.equal((await downloadReceivedRaw(new Request(url), env, now)).status, 200);
});
