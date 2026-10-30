import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('an uncertain D1 response does not delete a potentially committed R2 payload', async () => {
  const bundle = await build({ entryPoints: ['src/scheduled.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { scheduleEmail } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
  const stored = new Map(); const deleted = [];
  const env = {
    DB: { prepare() { return { bind() { return {}; } }; }, async batch() { throw new Error('response lost after commit'); } },
    INBOUND: { async put(key, value) { stored.set(key, value); }, async delete(key) { deleted.push(key); } },
  };
  await assert.rejects(scheduleEmail(env, { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Test', text: 'x'.repeat(1500001) }, '2031-01-01T00:00:00.000Z'));
  assert.equal(stored.size, 1);
  assert.deepEqual(deleted, []);
});

test('archive failures release the claim without attempting delivery or clearing the payload', async () => {
  const bundle = await build({ entryPoints: ['src/scheduled.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { processScheduled } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
  const updates = []; let sent = false;
  const env = {
    DB: { prepare(sql) { return { bind() { return this; }, async first() { if (sql.startsWith('UPDATE scheduled_emails SET state = \'sending\'')) return { payload: JSON.stringify({ from: 'a@example.test', to: 'b@example.test', subject: 'Test', text: 'Body' }), payload_r2_key: null }; return null; }, async all() { return { results: sql.startsWith('SELECT id FROM scheduled_emails') ? [{ id: 'test-id' }] : [] }; }, async run() { updates.push(sql); return { meta: { changes: 1 } }; } }; }, async batch() { throw new Error('must not finalize'); } },
    INBOUND: { async list() { return { objects: [], truncated: false }; }, async put() { throw new Error('R2 unavailable'); } },
    EMAIL: { async send() { sent = true; } },
  };
  await processScheduled(env);
  assert.equal(sent, false);
  assert.ok(updates.some(sql => sql.includes("SET state = 'scheduled' WHERE")));
  assert.ok(!updates.some(sql => sql.includes('payload = NULL')));
});
