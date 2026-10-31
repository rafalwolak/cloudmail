import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { attachmentId } from '../src/attachment-id.ts';
import { createDownloadUrl } from '../src/download-url.ts';
const bundle = await build({ entryPoints: ['src/attachment-download.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { downloadAttachment, sdkAttachmentMetadata } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const email = '11111111-1111-4111-8111-111111111111';
const otherEmail = '22222222-2222-4222-8222-222222222222';
const now = Date.UTC(2026, 9, 31);
function fixture() {
  const reads = []; const row = { body_stored: 1, schedule_state: null };
  const env = { BETTER_AUTH_SECRET: 'synthetic-signing-key-longer-than-32-characters', BETTER_AUTH_URL: 'https://mail.example.net', ADMIN_EMAIL: 'admin@example.net',
    DB: { prepare(sql) { reads.push('db'); assert.match(sql, /email_history/); return { bind(id) { assert.equal(id, email); return { first: async () => row }; } }; } },
    INBOUND: { async get(key) { reads.push('r2'); assert.equal(key, `sent/${email}`); return { json: async () => ({ html: null, text: 'Hi', attachments: [{ filename: 'untrusted.html', type: 'text/html', content: 'aGk=', disposition: 'attachment' }] }) }; } },
  };
  return { env, row, reads };
}
async function link(env, direction = 'sending', id = email, index = 0, purpose = 'cloudmail:attachment-download:v1') {
  const attachment = await attachmentId(direction, id, index);
  return createDownloadUrl(`/downloads/${direction}/${id}/attachments/${attachment}`, purpose, [direction, id, attachment], env, 3600, now);
}

test('attachment capabilities force private downloads, support HEAD, and expire at one hour', async () => {
  const { env, reads } = fixture(); const raw = await link(env);
  assert.equal(Date.parse(raw.expires_at), now + 3600000);
  const result = await downloadAttachment(new Request(raw.download_url), env, now);
  assert.equal(result.status, 200); assert.equal(await result.text(), 'hi'); assert.deepEqual(reads, ['db', 'r2']);
  assert.equal(result.headers.get('content-type'), 'application/octet-stream'); assert.match(result.headers.get('content-disposition'), /^attachment/);
  assert.equal(result.headers.get('cache-control'), 'private, no-store'); assert.equal(result.headers.get('referrer-policy'), 'no-referrer'); assert.equal(result.headers.get('x-content-type-options'), 'nosniff'); assert.match(result.headers.get('content-security-policy'), /default-src 'none'/);
  const head = await downloadAttachment(new Request(raw.download_url, { method: 'HEAD' }), env, now);
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '2'); assert.equal(await head.text(), '');
  reads.length = 0;
  assert.equal((await downloadAttachment(new Request(raw.download_url), env, now + 3600000)).status, 403); assert.deepEqual(reads, []);
});

test('attachment signature, scope, namespace, configuration and query failures never read storage', async () => {
  const { env, reads } = fixture(); const raw = await link(env);
  const other = await attachmentId('sending', email, 1);
  for (const mutate of [
    url => { url.searchParams.delete('signature'); },
    url => { const value = url.searchParams.get('signature'); url.searchParams.set('signature', `${value[0] === '0' ? '1' : '0'}${value.slice(1)}`); },
    url => { url.searchParams.append('expires', url.searchParams.get('expires')); },
    url => { url.searchParams.append('signature', url.searchParams.get('signature')); },
    url => { url.searchParams.set('extra', 'x'); },
    url => { url.searchParams.set('expires', String(now / 1000 + 3601)); },
    url => { url.pathname = url.pathname.replace(email, otherEmail); },
    url => { url.pathname = url.pathname.replace('/sending/', '/receiving/'); },
    url => { url.pathname = url.pathname.replace(url.pathname.split('/').at(-1), other); },
    url => { url.hostname = 'other.example.net'; },
  ]) {
    const url = new URL(raw.download_url); mutate(url);
    assert.equal((await downloadAttachment(new Request(url), env, now)).status, 403);
  }
  const wrongPurpose = await link(env, 'sending', email, 0, 'cloudmail:received-raw:v1');
  assert.equal((await downloadAttachment(new Request(wrongPurpose.download_url), env, now)).status, 403);
  for (const changes of [{ BETTER_AUTH_SECRET: 'another-synthetic-key-longer-than-32-characters' }, { ADMIN_EMAIL: 'replacement@example.net' }, { BETTER_AUTH_URL: 'https://other.example.net' }]) {
    assert.equal((await downloadAttachment(new Request(raw.download_url), { ...env, ...changes }, now)).status, 403);
  }
  assert.deepEqual(reads, []);
});

test('canceled messages and missing configuration fail closed without exposing archived attachments', async () => {
  const { env, row, reads } = fixture(); const raw = await link(env); row.schedule_state = 'canceled';
  assert.equal((await downloadAttachment(new Request(raw.download_url), env, now)).status, 404); assert.deepEqual(reads, ['db']);
  reads.length = 0;
  assert.equal((await downloadAttachment(new Request(raw.download_url, { method: 'POST' }), env, now)).status, 405); assert.deepEqual(reads, []);
  const unavailable = { ...env, BETTER_AUTH_SECRET: '' };
  assert.equal(await sdkAttachmentMetadata('sending', email, { id: '0', filename: 'x', size: 0, content_type: 'text/plain' }, unavailable), null);
  assert.equal((await downloadAttachment(new Request(raw.download_url), unavailable, now)).status, 403); assert.deepEqual(reads, []);
});
