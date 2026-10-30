import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readReceived } from '../src/inbound.ts';
import { readFile } from 'node:fs/promises';

test('message ID migration preserves existing inbound rows', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE inbound_emails (id TEXT PRIMARY KEY); INSERT INTO inbound_emails VALUES (\'existing\')');
    db.exec(await readFile(new URL('../migrations/0032_inbound_message_id.sql', import.meta.url), 'utf8'));
    assert.equal(db.prepare('SELECT message_id FROM inbound_emails WHERE id = ?').get('existing').message_id, null);
  } finally { db.close(); }
});

test('filters received messages literally and paginates the filtered result', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE inbound_emails (id TEXT, sender TEXT, recipient TEXT, subject TEXT, created_at TEXT, object_key TEXT, message_id TEXT)');
  const insert = db.prepare('INSERT INTO inbound_emails VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [id, sender, subject] of [['a', 'alice@example.com', '100% ready'], ['b', 'alice@example.com', '100% shipped'], ['c', 'bob@example.com', '100x ready']]) insert.run(id, sender, 'inbox@example.com', subject, `2030-01-0${id.charCodeAt(0) - 96}`, id, id === 'b' ? '<message@example.com>' : null);
  const env = { DB: { prepare(sql) { return { bind(...args) { return { async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return { results: db.prepare(sql).all(...args) }; } }; } }; } } };
  const get = query => readReceived(new Request(`https://example.com/emails/receiving?${query}`), env);
  try {
    const first = await (await get('from=ALICE&subject=%25&limit=1')).json();
    assert.deepEqual(first.data.map(item => item.id), ['b']); assert.equal(first.has_more, true);
    assert.equal(first.data[0].from, 'alice@example.com'); assert.deepEqual(first.data[0].to, ['inbox@example.com']);
    assert.equal(first.data[0].message_id, '<message@example.com>');
    const next = await (await get('from=ALICE&subject=%25&limit=1&after=b')).json();
    assert.deepEqual(next.data.map(item => item.id), ['a']); assert.equal(next.has_more, false);
    assert.equal(next.data[0].message_id, null);
    const previous = await (await get('to=INBOX&subject=%25&limit=1&before=a')).json();
    assert.deepEqual(previous.data.map(item => item.id), ['b']);
    assert.equal((await get('from=')).status, 400);
    assert.equal((await get('from=a&from=b')).status, 400);
  } finally { db.close(); }
});
