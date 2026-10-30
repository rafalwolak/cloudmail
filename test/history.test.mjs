import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };

test('accepted messages can be retrieved without claiming delivery', async () => {
  const send = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'History test', text: 'Sensitive content' }) });
  assert.equal(send.status, 200);
  const { id } = await send.json();
  const retrieved = await fetch(`${base}/emails/${encodeURIComponent(id)}`, { headers });
  assert.equal(retrieved.status, 200);
  const email = await retrieved.json();
  assert.equal(email.object, 'email');
  assert.equal(email.id, id);
  assert.equal(email.last_event, null);
  assert.equal(email.status, 'accepted');
  assert.equal(email.subject, 'History test');
  assert.equal(email.text, 'Sensitive content');
  assert.equal(email.html, null);
  const list = await fetch(`${base}/emails`, { headers });
  assert.equal(list.status, 200);
  const listed = (await list.json()).data.find(item => item.id === id);
  assert.ok(listed);
  assert.deepEqual(listed.cc, []);
  assert.deepEqual(listed.bcc, []);
  assert.equal(listed.reply_to, null);
  assert.equal(listed.last_event, null);
});

test('email history requires authorization', async () => {
  assert.equal((await fetch(`${base}/emails`)).status, 401);
});

test('immediate and scheduled email details retain cc, bcc and reply-to', async () => {
  for (const scheduled of [false, true]) {
    const message = { from: 'sender@example.com', to: 'to@example.com', cc: 'copy@example.com', bcc: ['private@example.com'], reply_to: 'reply@example.com', subject: 'Recipients', text: 'Hello', ...(scheduled ? { scheduled_at: new Date(Date.now() + 60000).toISOString() } : {}) };
    const send = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify(message) });
    assert.equal(send.status, 200, await send.clone().text());
    const { id } = await send.json();
    const result = await (await fetch(`${base}/emails/${id}`, { headers })).json();
    assert.deepEqual(result.cc, ['copy@example.com']);
    assert.deepEqual(result.bcc, ['private@example.com']);
    assert.equal(result.reply_to, 'reply@example.com');
    if (scheduled) assert.equal((await fetch(`${base}/emails/${id}/cancel`, { method: 'POST', headers })).status, 200);
  }
});

test('history uses stable before and after cursors', async () => {
  for (let i = 0; i < 4; i++) {
    const response = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ from: 'sender@example.com', to: 'recipient@example.com', subject: `Page ${i}`, text: 'Hi' }) });
    assert.equal(response.status, 200);
  }
  const get = async query => { const response = await fetch(`${base}/emails?${query}`, { headers }); assert.equal(response.status, 200); return response.json(); };
  const first = await get('limit=2');
  assert.equal(first.object, 'list');
  assert.equal(first.has_more, true);
  const second = await get(`limit=2&after=${first.data.at(-1).id}`);
  assert.equal(second.data.length, 2);
  assert.ok(second.data.every(email => !first.data.some(previous => previous.id === email.id)));
  const previous = await get(`limit=2&before=${second.data[0].id}`);
  assert.deepEqual(previous.data.map(email => email.id), first.data.map(email => email.id));
  assert.equal((await fetch(`${base}/emails?before=a&after=b`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/emails?after=missing`, { headers })).status, 400);
});

test('history reports the latest recorded recipient event', { skip: !process.env.TEST_D1_CONFIG || !process.env.TEST_D1_PERSIST }, async () => {
  const { execFileSync } = await import('node:child_process');
  const send = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'Last event', text: 'Hello' }) });
  assert.equal(send.status, 200);
  const { id } = await send.json();
  const sql = `INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at) SELECT '${id}-1', provider_id, 'recipient@example.com', 'delivered', '2030-01-01T00:00:00Z' FROM email_history WHERE id = '${id}'; INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at) SELECT '${id}-2', provider_id, 'recipient@example.com', 'bounced', '2030-01-02T00:00:00Z' FROM email_history WHERE id = '${id}'`;
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--persist-to', process.env.TEST_D1_PERSIST, '--command', sql], { stdio: 'ignore' });
  assert.equal((await (await fetch(`${base}/emails/${id}`, { headers })).json()).last_event, 'bounced');
  const list = await (await fetch(`${base}/emails?limit=100`, { headers })).json();
  assert.equal(list.data.find(item => item.id === id).last_event, 'bounced');
});
