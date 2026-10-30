import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };
const call = (path, method = 'GET', body, extra = {}) => fetch(`${base}${path}`, { method, headers: { ...headers, ...extra }, ...(body !== undefined && { body: JSON.stringify(body) }) });
const message = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Scheduled test', text: 'Private scheduled content' };

test('scheduled email can be rescheduled, canceled, and idempotently created', async () => {
  const scheduled_at = new Date(Date.now() + 60000).toISOString();
  const key = crypto.randomUUID();
  const first = await call('/emails', 'POST', { ...message, scheduled_at }, { 'Idempotency-Key': key });
  assert.equal(first.status, 200, await first.clone().text());
  const { id } = await first.json();
  const repeat = await call('/emails', 'POST', { ...message, scheduled_at }, { 'Idempotency-Key': key });
  assert.equal((await repeat.json()).id, id);
  assert.equal((await call('/emails', 'POST', { ...message, scheduled_at, subject: 'Changed' }, { 'Idempotency-Key': key })).status, 409);
  const stored = await (await call(`/emails/${id}`)).json();
  assert.equal(stored.status, 'scheduled');
  assert.equal(stored.scheduled_at, scheduled_at);
  assert.ok(!JSON.stringify(stored).includes(message.text));
  const later = new Date(Date.now() + 120000).toISOString();
  assert.equal((await call(`/emails/${id}`, 'PATCH', { scheduled_at: later })).status, 200);
  assert.equal((await (await call(`/emails/${id}`)).json()).scheduled_at, later);
  assert.equal((await call(`/emails/${id}/cancel`, 'POST', {})).status, 200);
  assert.equal((await (await call(`/emails/${id}`)).json()).status, 'canceled');
  assert.equal((await call(`/emails/${id}`, 'PATCH', { scheduled_at: later })).status, 409);
});

test('invalid schedules and attempts to cancel sent emails are rejected', async () => {
  for (const scheduled_at of ['tomorrow', new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 31 * 86400000).toISOString()]) assert.equal((await call('/emails', 'POST', { ...message, scheduled_at })).status, 400);
  assert.equal((await call('/emails/missing/cancel', 'POST', {})).status, 404);
});


test('cron sends a due email once despite concurrent invocations', { skip: process.env.TEST_CRON !== 'true' }, async () => {
  const scheduled_at = new Date(Date.now() + 1500).toISOString();
  const created = await call('/emails', 'POST', { ...message, scheduled_at });
  assert.equal(created.status, 200, await created.clone().text());
  const { id } = await created.json();
  await new Promise(resolve => setTimeout(resolve, 1800));
  const runs = await Promise.all([fetch(`${base}/cdn-cgi/local/scheduled?format=json`), fetch(`${base}/cdn-cgi/local/scheduled?format=json`)]);
  for (const run of runs) assert.equal(run.status, 200);
  const history = await (await call(`/emails/${id}`)).json();
  assert.equal(history.status, 'accepted');
});
