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
  assert.equal(email.id, id);
  assert.equal(email.status, 'accepted');
  assert.equal(email.subject, 'History test');
  assert.ok(!JSON.stringify(email).includes('Sensitive content'));
  const list = await fetch(`${base}/emails`, { headers });
  assert.equal(list.status, 200);
  assert.ok((await list.json()).data.some(item => item.id === id));
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
