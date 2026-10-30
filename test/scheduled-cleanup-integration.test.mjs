import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('canceled archive cleanup removes only canceled content using D1 and R2', async () => {
  const bundle = await build({ stdin: { contents: "import { cleanCanceledArchives } from './src/scheduled-cleanup.ts'; export default { async fetch(request, env) { await cleanCanceledArchives(env.DB, env.STORE); return new Response('ok'); } };", resolveDir: process.cwd(), sourcefile: 'test-worker.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const worker = new Miniflare({ workers: [{ config: { name: 'cancel-cleanup-test', compatibilityDate: '2026-10-23', manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } }, env: { DB: { type: 'd1', id: 'test-db' }, STORE: { type: 'r2', name: 'test-bucket' } } } }] });
  try {
    const db = await worker.getD1Database('DB'); const bucket = await worker.getR2Bucket('STORE');
    await db.exec("CREATE TABLE scheduled_emails (id TEXT PRIMARY KEY, state TEXT, archive_cleanup_pending INTEGER); CREATE TABLE email_history (id TEXT PRIMARY KEY, body_stored INTEGER); INSERT INTO scheduled_emails VALUES ('cancelled', 'canceled', 1), ('active', 'scheduled', 0); INSERT INTO email_history VALUES ('cancelled', 1), ('active', 1)");
    await bucket.put('sent/cancelled', 'private'); await bucket.put('sent/active', 'keep');
    assert.equal((await worker.dispatchFetch('http://localhost/')).status, 200);
    assert.equal(await bucket.get('sent/cancelled'), null);
    assert.equal(await (await bucket.get('sent/active')).text(), 'keep');
    assert.equal((await db.prepare("SELECT archive_cleanup_pending FROM scheduled_emails WHERE id = 'cancelled'").first()).archive_cleanup_pending, 0);
    assert.equal((await db.prepare("SELECT body_stored FROM email_history WHERE id = 'cancelled'").first()).body_stored, 0);
  } finally { await worker.dispose(); }
});

test('scheduled orphan cleanup uses real D1 and R2 bindings', async () => {
  const bundle = await build({ stdin: { contents: "import { cleanOrphanedScheduledPayloads } from './src/scheduled-cleanup.ts'; export default { async fetch(request, env) { await cleanOrphanedScheduledPayloads(env.DB, env.STORE, Date.now() + 25 * 3600000); return new Response('ok'); } };", resolveDir: process.cwd(), sourcefile: 'test-worker.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const worker = new Miniflare({ workers: [{ config: { name: 'cleanup-test', compatibilityDate: '2026-10-23', manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } }, env: { DB: { type: 'd1', id: 'test-db' }, STORE: { type: 'r2', name: 'test-bucket' } } } }] });
  try {
    const db = await worker.getD1Database('DB'); const bucket = await worker.getR2Bucket('STORE');
    await db.exec('CREATE TABLE scheduled_cleanup_cursor (id INTEGER PRIMARY KEY, cursor TEXT); INSERT INTO scheduled_cleanup_cursor VALUES (1, NULL); CREATE TABLE scheduled_emails (id TEXT PRIMARY KEY, payload_r2_key TEXT)');
    const active = 'scheduled/00000000-0000-4000-8000-000000000001';
    const orphan = 'scheduled/00000000-0000-4000-8000-000000000002';
    await bucket.put(active, 'active'); await bucket.put(orphan, 'orphan'); await bucket.put('inbound/unrelated', 'unrelated');
    await db.prepare('INSERT INTO scheduled_emails VALUES (?, ?)').bind('active', active).run();
    assert.equal((await worker.dispatchFetch('http://localhost/')).status, 200);
    assert.equal(await (await bucket.get(active)).text(), 'active');
    assert.equal(await bucket.get(orphan), null);
    assert.equal(await (await bucket.get('inbound/unrelated')).text(), 'unrelated');
  } finally { await worker.dispose(); }
});
