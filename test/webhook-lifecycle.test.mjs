import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };
const sql = command => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--command', command], { stdio: 'pipe' });

test('sent and received lifecycle events enqueue atomically and inbound deletion removes queued data', { skip: !process.env.TEST_D1_CONFIG }, async () => {
  const created = await fetch(`${base}/webhooks`, { method: 'POST', headers, body: JSON.stringify({ endpoint: 'https://hooks.example.com/lifecycle', events: ['email.sent', 'email.received'] }) });
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json(); const inboundId = crypto.randomUUID();
  try {
    const send = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ from: 'a@example.com', to: ['b@example.com', 'c@example.com'], subject: 'Lifecycle', text: 'Hi' }) });
    assert.equal(send.status, 200); const sent = await send.json();
    sql(`INSERT INTO inbound_emails (id, sender, recipient, subject, created_at, object_key) VALUES ('${inboundId}', 'external@example.com', 'inbox@example.com', 'Received', '2026-10-30T10:00:00.000Z', 'test/${inboundId}')`);
    let deliveries = await (await fetch(`${base}/webhooks/${id}/deliveries?limit=100`, { headers })).json();
    assert.equal(deliveries.data.filter(item => item.event_id === `sent:${sent.id}`).length, 1);
    assert.equal(deliveries.data.filter(item => item.event_id === `received:${inboundId}`).length, 1);
    sql(`DELETE FROM inbound_emails WHERE id = '${inboundId}'`);
    deliveries = await (await fetch(`${base}/webhooks/${id}/deliveries?limit=100`, { headers })).json();
    assert.equal(deliveries.data.some(item => item.event_id === `received:${inboundId}`), false);
  } finally { await fetch(`${base}/webhooks/${id}`, { method: 'DELETE', headers }); sql(`DELETE FROM inbound_emails WHERE id = '${inboundId}'`); }
});
