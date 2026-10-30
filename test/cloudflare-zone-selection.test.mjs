import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { addCloudflareZone, listSelectedCloudflareZones } from '../src/cloudflare-zone-selection.ts';

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY); INSERT INTO "user" VALUES (\'admin\'), (\'other\');');
  for (const file of ['0026_cloudflare_oauth_connection.sql', '0027_cloudflare_zones.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO cloudflare_oauth_connections (user_id, ciphertext) VALUES ('admin', 'x'), ('other', 'x')");
  return { sqlite, prepare(sql) { return { bind(...args) { return { async run() { return sqlite.prepare(sql).run(...args); }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } }; } }; } };
}

test('zone selection verifies Cloudflare access and stores multiple zones per administrator', async () => {
  const db = await database(), original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(options.headers.authorization, 'Bearer token'); assert.equal(options.redirect, 'manual'); const id = url.split('/').at(-1); return Response.json({ success: true, result: { id, name: `${id[0]}.example.com`, account: { id: 'account' } } }); };
  try {
    for (const id of ['a'.repeat(32), 'b'.repeat(32)]) await addCloudflareZone(db, 'admin', 'token', id);
    assert.deepEqual((await listSelectedCloudflareZones(db, 'admin')).map(zone => zone.name), ['a.example.com', 'b.example.com']);
    assert.deepEqual(await listSelectedCloudflareZones(db, 'other'), []);
    assert.equal(calls, 2);
    db.sqlite.prepare('DELETE FROM cloudflare_oauth_connections WHERE user_id = ?').run('admin');
    assert.deepEqual(await listSelectedCloudflareZones(db, 'admin'), []);
  } finally { globalThis.fetch = original; db.sqlite.close(); }
});

test('zone selection does not persist inaccessible or mismatched zones', async () => {
  const db = await database(), original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ success: false }, { status: 403 });
    await assert.rejects(addCloudflareZone(db, 'admin', 'token', 'a'.repeat(32)));
    globalThis.fetch = async () => Response.json({ success: true, result: { id: 'b'.repeat(32), name: 'example.com', account: { id: 'account' } } });
    await assert.rejects(addCloudflareZone(db, 'admin', 'token', 'a'.repeat(32)));
    assert.deepEqual(await listSelectedCloudflareZones(db, 'admin'), []);
  } finally { globalThis.fetch = original; db.sqlite.close(); }
});
