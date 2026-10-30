import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('recipient filter includes To, Cc and Bcc without changing the To filter', async () => {
  const bundle = await build({ stdin: { contents: "import { readHistory } from './src/history.ts'; export default { fetch(request, env) { return readHistory(request, env); } };", resolveDir: process.cwd(), sourcefile: 'test-history-worker.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const worker = new Miniflare({ workers: [{ config: { name: 'history-test', compatibilityDate: '2026-10-23', compatibilityFlags: ['nodejs_compat'], manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } }, env: { DB: { type: 'd1', id: 'history-test-db' } } } }] });
  try {
    const db = await worker.getD1Database('DB');
    await db.exec("CREATE TABLE email_history (id TEXT PRIMARY KEY, sender TEXT, recipients TEXT, subject TEXT, status TEXT, created_at TEXT, tags TEXT, cc TEXT, bcc TEXT, reply_to TEXT, provider_id TEXT); CREATE TABLE scheduled_emails (id TEXT, state TEXT, scheduled_at TEXT, prepare_attempts INTEGER, prepare_after TEXT); CREATE TABLE delivery_events (provider_id TEXT, type TEXT, occurred_at TEXT, id TEXT)");
    await db.prepare('INSERT INTO email_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('one', 'sender@example.com', '["to@example.com"]', 'Subject', 'accepted', '2030-01-01T00:00:00Z', '[]', '["copy@example.com"]', '["private@example.com"]', null, null).run();
    for (const address of ['TO@example.com', 'COPY@example.com', 'PRIVATE@example.com']) {
      const result = await (await worker.dispatchFetch(`http://localhost/emails?recipient=${encodeURIComponent(address)}`)).json();
      assert.deepEqual(result.data.map(item => item.id), ['one']);
    }
    const toOnly = await (await worker.dispatchFetch('http://localhost/emails?to=private%40example.com')).json();
    assert.deepEqual(toOnly.data, []);
    assert.equal((await worker.dispatchFetch('http://localhost/emails?recipient=%20')).status, 400);
  } finally { await worker.dispose(); }
});
