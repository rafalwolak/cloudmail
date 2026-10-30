import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('relative schedules preserve idempotency across retries', async () => {
  const key = crypto.randomUUID();
  const request = { ...message, scheduled_at: 'in 1 min' };
  const first = await call('/emails', 'POST', request, { 'Idempotency-Key': key });
  assert.equal(first.status, 200, await first.clone().text());
  const result = await first.json();
  await new Promise(resolve => setTimeout(resolve, 20));
  const retry = await call('/emails', 'POST', request, { 'Idempotency-Key': key });
  assert.equal(retry.status, 200, await retry.clone().text());
  assert.deepEqual(await retry.json(), result);
  assert.equal((await call('/emails', 'POST', { ...request, scheduled_at: 'in 2 min' }, { 'Idempotency-Key': key })).status, 409);
  assert.equal((await call(`/emails/${result.id}/cancel`, 'POST')).status, 200);
});

test('invalid schedules and attempts to cancel sent emails are rejected', async () => {
  for (const scheduled_at of ['tomorrow', new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 31 * 86400000).toISOString()]) assert.equal((await call('/emails', 'POST', { ...message, scheduled_at })).status, 400);
  assert.equal((await call('/emails/missing/cancel', 'POST', {})).status, 404);
});

test('large scheduled messages use R2 and cleanup after cancellation', { skip: !process.env.TEST_D1_CONFIG }, async () => {
  const sql = command => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--json', '--command', command], { encoding: 'utf8' }))[0].results;
  const scheduled_at = new Date(Date.now() + 600000).toISOString();
  const request = { ...message, scheduled_at, attachments: [{ filename: 'large.txt', content: Buffer.alloc(1600000, 65).toString('base64'), content_type: 'text/plain' }] };
  const key = crypto.randomUUID();
  const first = await call('/emails', 'POST', request, { 'Idempotency-Key': key });
  assert.equal(first.status, 200, await first.clone().text());
  const { id } = await first.json();
  const stored = sql(`SELECT payload, payload_r2_key FROM scheduled_emails WHERE id = '${id}'`)[0];
  assert.equal(stored.payload, null);
  assert.equal(stored.payload_r2_key, `scheduled/${id}`);
  const getObject = () => execFileSync('npx', ['wrangler', 'r2', 'object', 'get', `cloudmail-inbound/scheduled/${id}`, '--local', '--config', process.env.TEST_D1_CONFIG, '--pipe'], { maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(JSON.parse(getObject().toString()).attachments[0].filename, 'large.txt');
  const repeat = await call('/emails', 'POST', request, { 'Idempotency-Key': key });
  assert.equal((await repeat.json()).id, id);
  assert.equal((await call(`/emails/${id}/cancel`, 'POST', {})).status, 200);
  const cron = await fetch(`${base}/cdn-cgi/local/scheduled?format=json`);
  assert.equal(cron.status, 200);
  assert.equal(sql(`SELECT payload_r2_key FROM scheduled_emails WHERE id = '${id}'`)[0].payload_r2_key, null);
  assert.throws(getObject);
  const second = await call('/emails', 'POST', request);
  assert.equal(second.status, 200);
  const secondId = (await second.json()).id;
  sql(`UPDATE scheduled_emails SET scheduled_at = '2000-01-01T00:00:00.000Z' WHERE id = '${secondId}'`);
  assert.equal((await fetch(`${base}/cdn-cgi/local/scheduled?format=json`)).status, 200);
  assert.equal((await (await call(`/emails/${secondId}`)).json()).status, 'accepted');
  assert.equal((await fetch(`${base}/cdn-cgi/local/scheduled?format=json`)).status, 200);
  assert.equal(sql(`SELECT payload_r2_key FROM scheduled_emails WHERE id = '${secondId}'`)[0].payload_r2_key, null);
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
