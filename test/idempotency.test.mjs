import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const body = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Idempotency', text: 'Hello' };
const send = (idempotencyKey, payload = body) => fetch(`${base}/emails`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload) });

test('repeated idempotent sends return the original id', async () => {
  const idempotencyKey = crypto.randomUUID();
  const first = await send(idempotencyKey);
  const next = await send(idempotencyKey);
  assert.equal(first.status, 200);
  assert.equal(next.status, 200);
  assert.equal((await first.json()).id, (await next.json()).id);
});

test('the same idempotency key cannot be reused with different payloads', async () => {
  const idempotencyKey = crypto.randomUUID();
  assert.equal((await send(idempotencyKey)).status, 200);
  const response = await send(idempotencyKey, { ...body, subject: 'Different' });
  assert.equal(response.status, 409);
});

test('concurrent identical requests cause at most one send', async () => {
  const idempotencyKey = crypto.randomUUID();
  const responses = await Promise.all(Array.from({ length: 8 }, () => send(idempotencyKey)));
  assert.ok(responses.every(response => [200, 409].includes(response.status)));
  const ids = await Promise.all(responses.filter(response => response.status === 200).map(async response => (await response.json()).id));
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, 1);
});

test('rejects idempotency keys longer than 256 characters', async () => {
  assert.equal((await send('x'.repeat(257))).status, 400);
});
