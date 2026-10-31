import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resend } from 'resend';
import { localTestOrigin } from './local-auth-mail.mjs';
import { injectReceivedFixture } from './received-fixture.mjs';

const base = localTestOrigin(process.env.TEST_BASE_URL || 'http://127.0.0.1:8787');
const key = process.env.TEST_API_KEY || 'local-test-key';
const client = new Resend(key, { baseUrl: `${base}/v1` });
const headers = { authorization: `Bearer ${key}` };
function success(result) { assert.equal(result.error === null, true, 'Official SDK request failed'); return result.data; }
function metadata(item) {
  assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(typeof item.filename, 'string'); assert.equal(typeof item.size, 'number');
  assert.equal(new URL(item.download_url).origin, base);
  assert.ok(Date.parse(item.expires_at) > Date.now());
  assert.ok(Date.parse(item.expires_at) <= Date.now() + 3600000);
}
const input = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Synthetic SDK attachments', text: 'Hi', attachments: [{ filename: 'first.txt', content: 'aGk=' }, { filename: 'logo.png', content: 'eA==', contentType: 'image/png', contentId: 'logo' }] };

test('official SDK sends and retrieves sent attachment metadata with private expiring downloads', async () => {
  const sent = success(await client.emails.send(input));
  const first = success(await client.emails.attachments.list({ emailId: sent.id, limit: 1 }));
  assert.equal(first.object, 'list'); assert.equal(first.has_more, true); assert.equal(first.data.length, 1); metadata(first.data[0]);
  const item = success(await client.emails.attachments.get({ emailId: sent.id, id: first.data[0].id }));
  metadata(item); assert.equal(item.object, 'attachment'); assert.equal(item.id, first.data[0].id); assert.equal(item.size, 2);
  const file = await fetch(item.download_url); assert.equal(file.status, 200); assert.equal(await file.text(), 'hi');
  assert.match(file.headers.get('content-disposition'), /^attachment/); assert.equal(file.headers.get('referrer-policy'), 'no-referrer');
  const next = success(await client.emails.attachments.list({ emailId: sent.id, after: item.id, limit: 1 }));
  assert.equal(next.has_more, false); assert.equal(next.data[0].filename, 'logo.png'); assert.equal(next.data[0].content_id, 'logo'); assert.equal(next.data[0].content_disposition, 'inline'); metadata(next.data[0]);
  const previous = success(await client.emails.attachments.list({ emailId: sent.id, before: next.data[0].id, limit: 1 }));
  assert.equal(previous.data[0].id, item.id);
  const detail = success(await client.emails.get(sent.id)); assert.equal(detail.attachments[0].id, item.id);
  const legacy = await fetch(`${base}/emails/${sent.id}/attachments/0`, { headers }); assert.equal(legacy.status, 200); assert.equal(await legacy.text(), 'hi');
  const altered = new URL(item.download_url); altered.searchParams.delete('signature'); assert.equal((await fetch(altered)).status, 403);
});

test('official SDK receives native MIME and downloads attachment metadata without changing legacy indexes', { skip: process.env.TEST_INBOUND !== 'true' }, async () => {
  const marker = await injectReceivedFixture(base);
  const list = await (await fetch(`${base}/emails/receiving?subject=${encodeURIComponent(marker)}`, { headers })).json();
  assert.equal(list.data.length, 1); const id = list.data[0].id;
  try {
    const detail = success(await client.emails.receiving.get(id)); assert.deepEqual(detail.to, ['inbox@example.com']);
    const attachments = success(await client.emails.receiving.attachments.list({ emailId: id }));
    assert.equal(attachments.data.length, 1); const item = attachments.data[0]; metadata(item);
    assert.equal(detail.attachments[0].id, item.id);
    const single = success(await client.emails.receiving.attachments.get({ emailId: id, id: item.id }));
    assert.equal(single.id, item.id); assert.equal(single.object, 'attachment');
    const download = await fetch(single.download_url); assert.equal(download.status, 200); assert.equal(await download.text(), 'hi');
    const head = await fetch(single.download_url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const legacy = await (await fetch(`${base}/emails/receiving/${id}`, { headers })).json();
    assert.equal(legacy.to, 'inbox@example.com'); assert.equal(legacy.attachments[0].id, '0');
    const swapped = new URL(single.download_url); swapped.pathname = swapped.pathname.replace('/receiving/', '/sending/');
    assert.equal((await fetch(swapped)).status, 403);
    assert.equal((await fetch(single.download_url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/emails/receiving/${id}`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(single.download_url)).status, 404);
  } finally { await fetch(`${base}/emails/receiving/${id}`, { method: 'DELETE', headers }); }
});

test('SDK attachment cursors and identities reject ambiguity and never fall back to binary responses', async () => {
  const first = success(await client.emails.send(input)); const second = success(await client.emails.send(input));
  const list = success(await client.emails.attachments.list({ emailId: first.id })); const id = list.data[0].id;
  const wrongMessage = await client.emails.attachments.get({ emailId: second.id, id });
  assert.equal(wrongMessage.error?.statusCode, 404); assert.equal(wrongMessage.error?.name, 'not_found');
  const index = await client.emails.attachments.get({ emailId: first.id, id: '0' });
  assert.equal(index.error?.statusCode, 404); assert.equal(index.error?.name, 'not_found');
  for (const query of [`after=${id}&after=${id}`, `after=${id}&before=${id}`, 'after=0', 'limit=1&limit=2', 'extra=1']) {
    const response = await fetch(`${base}/v1/emails/${first.id}/attachments?${query}`, { headers });
    assert.equal(response.status, 400); assert.equal((await response.json()).name, 'validation_error');
  }
  assert.equal((await fetch(`${base}/v1/emails/${first.id}/attachments/${id}?extra=1`, { headers })).status, 400);
  for (const path of ['/v1/api/auth/get-session', '/v1/api/keys', '/v1/mcp', '/v1/dashboard', '/v1/downloads/receiving/invalid/raw']) {
    assert.equal((await fetch(base + path, { headers })).status, 404);
  }
  const denied = await new Resend('wrong-local-key', { baseUrl: `${base}/v1` }).emails.attachments.list({ emailId: first.id });
  assert.equal(denied.error?.name, 'invalid_api_key'); assert.equal(denied.error?.statusCode, 401);
});

test('scheduled attachment URLs stop working after cancellation and cannot address another attachment', async () => {
  const scheduled = success(await client.emails.send({ ...input, scheduledAt: 'in 20 min' }));
  const list = success(await client.emails.attachments.list({ emailId: scheduled.id }));
  const url = new URL(list.data[0].download_url); const other = new URL(list.data[1].download_url);
  const changed = new URL(url); changed.pathname = other.pathname;
  assert.equal((await fetch(changed)).status, 403);
  assert.equal((await fetch(url)).status, 200);
  success(await client.emails.cancel(scheduled.id));
  assert.equal((await fetch(url)).status, 404);
  const missing = await client.emails.attachments.get({ emailId: scheduled.id, id: list.data[0].id });
  assert.equal(missing.error?.statusCode, 404);
});

test('sending-only SDK credentials cannot obtain attachment capabilities', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const response = await fetch(`${base}/api-keys`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'SDK restricted test', permission: 'sending_access' }) });
  assert.equal(response.status, 201); const created = await response.json();
  const restricted = new Resend(created.token, { baseUrl: `${base}/v1` });
  try {
    const sent = success(await restricted.emails.send(input));
    const list = await restricted.emails.attachments.list({ emailId: sent.id });
    assert.equal(list.error?.name, 'restricted_api_key'); assert.equal(list.error?.statusCode, 403);
    const full = success(await client.emails.attachments.list({ emailId: sent.id }));
    const get = await restricted.emails.attachments.get({ emailId: sent.id, id: full.data[0].id });
    assert.equal(get.error?.name, 'restricted_api_key'); assert.equal(get.error?.statusCode, 403);
    const removed = success(await client.apiKeys.remove(created.id)); assert.equal(removed.id, created.id);
  } finally { await fetch(`${base}/api-keys/${created.id}`, { method: 'DELETE', headers }); }
});
