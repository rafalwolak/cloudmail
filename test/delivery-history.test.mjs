import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';

test('delivery events are joined to the correct message by provider ID', { skip: !process.env.TEST_D1_CONFIG }, async () => {
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json', connection: 'close' };
  const send = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ from: 'a@example.com', to: 'b@example.com', subject: 'Delivery test', text: 'Hi' }) });
  assert.equal(send.status, 200);
  const { id } = await send.json();
  assert.match(id, /^[a-f0-9-]+$/);
  const eventId = crypto.randomUUID();
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, ...(process.env.TEST_D1_PERSIST ? ['--persist-to', process.env.TEST_D1_PERSIST] : []), '--command', `INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at, details) SELECT '${eventId}', provider_id, 'b@example.com', 'delivered', '2026-10-30T10:00:00.000Z', '{"smtp_status_code":"250"}' FROM email_history WHERE id = '${id}'`], { stdio: 'pipe' });
  const response = await fetch(`${base}/emails/${id}`, { headers });
  const result = await response.json();
  assert.deepEqual(result.delivery_events, [{ recipient: 'b@example.com', type: 'delivered', occurred_at: '2026-10-30T10:00:00.000Z', details: { smtp_status_code: '250' } }]);
  assert.equal(result.status, 'accepted');
});

test('delivery events paginate stably and reject unrelated cursors', { skip: !process.env.TEST_D1_CONFIG }, async () => {
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json', connection: 'close' };
  const send = async () => (await (await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ from: 'a@example.com', to: 'b@example.com', subject: 'Event pages', text: 'Hi' }) })).json()).id;
  const firstId = await send(); const secondId = await send();
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  for (const [index, id] of ids.entries()) {
    const email = index === 4 ? secondId : firstId;
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, ...(process.env.TEST_D1_PERSIST ? ['--persist-to', process.env.TEST_D1_PERSIST] : []), '--command', `INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at) SELECT '${id}', provider_id, 'b@example.com', 'delivered', '2026-10-30T10:00:00.000Z' FROM email_history WHERE id = '${email}'`], { stdio: 'pipe' });
  }
  const get = query => fetch(`${base}/emails/${firstId}/events?${query}`, { headers });
  const initial = await get('limit=2'); assert.equal(initial.status, 200);
  const page = await initial.json(); assert.equal(page.data.length, 2); assert.equal(page.has_more, true);
  const next = await (await get(`limit=2&after=${page.data[1].id}`)).json();
  assert.equal(next.data.length, 2); assert.equal(next.has_more, false);
  assert.equal(new Set([...page.data, ...next.data].map(event => event.id)).size, 4);
  assert.equal((await get(`after=${ids[4]}`)).status, 400);
  assert.equal((await get('limit=101')).status, 400);
});
