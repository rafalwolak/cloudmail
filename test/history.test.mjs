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
