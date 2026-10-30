import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';
const send = (body) => fetch(`${base}/emails`, {
  method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const message = { from: 'sender@example.com', to: ['a@example.com', 'b@example.com'], subject: 'Hello', text: 'Hi', cc: ['c@example.com'], bcc: ['d@example.com'], reply_to: 'reply@example.com', headers: { 'X-Source': 'test' } };

test('sends multiple recipients with cc, bcc, reply-to and headers', async () => {
  const response = await send(message);
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok((await response.json()).id);
});

test('rejects unsupported fields instead of silently discarding them', async () => {
  const response = await send({ ...message, to: 'a@example.com', scheduled_at: '2027-01-01T00:00:00Z' });
  assert.equal(response.status, 400);
});

test('rejects more than 50 recipients', async () => {
  const response = await send({ ...message, to: Array(51).fill('a@example.com') });
  assert.equal(response.status, 400);
});


test('requires a valid API key', async () => {
  const response = await fetch(`${base}/emails`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
  assert.equal(response.status, 401);
});

test('validates recipient types and combined recipient limit', async () => {
  const invalid = await send({ ...message, to: ['a@example.com', 123] });
  assert.equal(invalid.status, 400);
  const tooMany = await send({ ...message, to: Array(49).fill('a@example.com'), cc: ['b@example.com', 'c@example.com'], bcc: undefined });
  assert.equal(tooMany.status, 400);
});

test('accepts base64 attachments through the email API', async () => {
  const response = await send({ ...message, attachments: [{ filename: 'hello.txt', content: 'SGVsbG8=', content_type: 'text/plain' }] });
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok((await response.json()).id);
});

test('stores valid tags on sent emails and rejects invalid tags', async () => {
  const tags = [{ name: 'category', value: 'password_reset' }, { name: 'customer', value: '123-ABC' }];
  const response = await send({ ...message, tags });
  assert.equal(response.status, 200, await response.clone().text());
  const { id } = await response.json();
  const history = await fetch(`${base}/emails/${id}`, { headers: { authorization: `Bearer ${key}` } });
  assert.deepEqual((await history.json()).tags, tags);
  const batch = await fetch(`${base}/emails/batch`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify([{ ...message, tags }]) });
  assert.equal(batch.status, 200);
  const batchId = (await batch.json()).data[0].id;
  assert.deepEqual((await (await fetch(`${base}/emails/${batchId}`, { headers: { authorization: `Bearer ${key}` } })).json()).tags, tags);
  for (const invalid of [[{ name: 'bad space', value: 'ok' }], [{ name: 'ok', value: '' }], [{ name: 'ok', value: 'ok', extra: true }], 'invalid']) {
    assert.equal((await send({ ...message, tags: invalid })).status, 400);
  }
});
