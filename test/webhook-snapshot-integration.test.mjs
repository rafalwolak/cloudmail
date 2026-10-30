import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('webhook delivery retrieval and replay preserve the stored payload in D1', async () => {
  const bundle = await build({ stdin: { contents: "import { manageWebhooks } from './src/webhooks.ts'; export default { fetch(request, env) { return manageWebhooks(request, env); } };", resolveDir: process.cwd(), sourcefile: 'test-webhook-worker.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const worker = new Miniflare({ workers: [{ config: { name: 'webhook-test', compatibilityDate: '2026-10-23', manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } }, env: { DB: { type: 'd1', id: 'webhook-test-db' } } } }] });
  try {
    const db = await worker.getD1Database('DB');
    await db.exec("CREATE TABLE delivery_events (id TEXT PRIMARY KEY, type TEXT, occurred_at TEXT); CREATE TABLE webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT, event_id TEXT, state TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, next_attempt TEXT, last_status INTEGER, replay_of TEXT, payload TEXT, event_type TEXT)");
    const webhook = '00000000-0000-4000-8000-000000000001'; const delivery = '12345678901234567890123456789012';
    const payload = { type: 'email.delivered', data: { to: ['recipient@example.com'] } };
    await db.prepare('INSERT INTO delivery_events VALUES (?, ?, ?)').bind('event1', 'delivered', '2030-01-01T00:00:00.000Z').run();
    await db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, event_id, next_attempt, payload) VALUES (?, ?, ?, ?, ?)').bind(delivery, webhook, 'event1', '2030-01-01T00:00:00.000Z', JSON.stringify(payload)).run();
    const path = `http://localhost/webhooks/${webhook}/deliveries/${delivery}`;
    const first = await worker.dispatchFetch(path); assert.equal(first.status, 200); assert.deepEqual((await first.json()).payload, payload);
    const replay = await worker.dispatchFetch(`${path}/replay`, { method: 'POST' }); assert.equal(replay.status, 201);
    const replayId = (await replay.json()).id;
    const retried = await worker.dispatchFetch(`http://localhost/webhooks/${webhook}/deliveries/${replayId}`);
    assert.deepEqual((await retried.json()).payload, payload);
    assert.equal((await worker.dispatchFetch(`http://localhost/webhooks/${webhook}/deliveries/${'0'.repeat(32)}`)).status, 404);
  } finally { await worker.dispose(); }
});
