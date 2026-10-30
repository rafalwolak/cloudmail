import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

test('deferred events select and preserve the subscribed webhook name', async () => {
  const worker = new Miniflare({ workers: [{ config: { name: 'delayed-test', compatibilityDate: '2026-10-23', manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: 'export default { fetch() { return new Response(); } }' } } }, env: { DB: { type: 'd1', id: 'delayed-db' } } } }] });
  try {
    const db = await worker.getD1Database('DB');
    await db.exec('CREATE TABLE webhooks (id TEXT, events TEXT); CREATE TABLE delivery_events (id TEXT, type TEXT); CREATE TABLE webhook_deliveries (id TEXT, webhook_id TEXT, event_id TEXT, next_attempt TEXT); CREATE TRIGGER enqueue_delivery_event AFTER INSERT ON delivery_events BEGIN SELECT 1; END');
    const migration = await readFile(new URL('../migrations/0034_webhook_delivery_type.sql', import.meta.url), 'utf8');
    const trigger = migration.indexOf('CREATE TRIGGER');
    for (const statement of migration.slice(0, trigger).split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    await db.prepare(migration.slice(trigger).trim()).run();
    for (const [id, events] of [['legacy', ['email.deferred']], ['resend', ['email.delivery_delayed']], ['both', ['email.deferred', 'email.delivery_delayed']], ['other', ['email.delivered']]]) await db.prepare('INSERT INTO webhooks VALUES (?, ?)').bind(id, JSON.stringify(events)).run();
    await db.prepare("INSERT INTO delivery_events VALUES ('event1', 'deferred')").run();
    const result = await db.prepare('SELECT webhook_id, event_type FROM webhook_deliveries ORDER BY webhook_id').all();
    assert.deepEqual(result.results, [{ webhook_id: 'both', event_type: 'email.delivery_delayed' }, { webhook_id: 'legacy', event_type: 'email.deferred' }, { webhook_id: 'resend', event_type: 'email.delivery_delayed' }]);
  } finally { await worker.dispose(); }
});
