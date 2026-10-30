import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';
const email = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Batch', text: 'Hello' };
const send = (body, idempotencyKey) => fetch(`${base}/emails/batch`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: JSON.stringify(body) });

test('batch sends multiple transactional messages and returns their ids', async () => {
  const response = await send([email, { ...email, subject: 'Second' }]);
  assert.equal(response.status, 200, await response.clone().text());
  const { data } = await response.json();
  assert.equal(data.length, 2);
  assert.notEqual(data[0].id, data[1].id);
});

test('batch validates every item before sending', async () => {
  const response = await send([email, { ...email, to: [] }]);
  assert.equal(response.status, 400);
  assert.equal((await send([])).status, 400);
  assert.equal((await send(Array(101).fill(email))).status, 400);
});

test('batch idempotency returns the same ids and rejects a changed batch', async () => {
  const key = crypto.randomUUID();
  const first = await send([email, email], key);
  const second = await send([email, email], key);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
  assert.equal((await send([email, { ...email, subject: 'Changed' }], key)).status, 409);
});

test('concurrent batches with one idempotency key do not duplicate sends', async () => {
  const batchKey = crypto.randomUUID();
  const responses = await Promise.all(Array.from({ length: 5 }, () => send([email, email], batchKey)));
  assert.ok(responses.every(response => [200, 409].includes(response.status)));
  const successes = await Promise.all(responses.filter(response => response.status === 200).map(response => response.json()));
  assert.ok(successes.length > 0);
  assert.equal(new Set(successes.map(result => JSON.stringify(result.data))).size, 1);
});

test('batch requires authentication', async () => {
  const response = await fetch(`${base}/emails/batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([email]) });
  assert.equal(response.status, 401);
});
