import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/history.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { sendRecordedEmail } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const email = { from: 'a@example.test', to: 'b@example.test', subject: 'Test', text: 'Body' };

test('a storage failure before sending releases the history row and idempotency key', async () => {
  const statements = []; let sent = false; let deleted = false;
  const env = {
    DB: { prepare(sql) { return { bind() { return { async run() { statements.push(sql); return { meta: { changes: 1 } }; } }; } }; } },
    INBOUND: { async put() { throw new Error('R2 unavailable'); }, async delete() { deleted = true; } },
    EMAIL: { async send() { sent = true; } },
  };
  await assert.rejects(sendRecordedEmail(env, email, 'test-key'), /R2 unavailable/);
  assert.equal(sent, false);
  assert.ok(statements.some(sql => sql.startsWith('DELETE FROM email_history')));
  assert.equal(deleted, true);
});

test('an uncertain database deletion does not remove a potentially referenced object', async () => {
  let deleted = false;
  const env = {
    DB: { prepare(sql) { return { bind() { return { async run() { if (sql.startsWith('DELETE')) throw new Error('D1 unavailable'); return { meta: { changes: 1 } }; } }; } }; } },
    INBOUND: { async put() { throw new Error('R2 unavailable'); }, async delete() { deleted = true; } },
    EMAIL: { async send() { throw new Error('must not send'); } },
  };
  await assert.rejects(sendRecordedEmail(env, email), /R2 unavailable/);
  assert.equal(deleted, false);
});
