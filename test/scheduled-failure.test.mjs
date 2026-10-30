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
