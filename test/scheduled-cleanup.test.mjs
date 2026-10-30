import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOrphanedScheduledPayloads } from '../src/scheduled-cleanup.ts';

test('orphan cleanup retains referenced, recent and unrelated objects and advances the cursor', async () => {
  const now = Date.parse('2031-01-03T00:00:00Z');
  const old = new Date(now - 25 * 3600000); const recent = new Date(now - 3600000);
  const key = suffix => `scheduled/00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  const deleted = []; let savedCursor = 'previous';
  const db = { prepare(sql) { return { bind(value) { return { async first() { return value === key('1') ? { id: 'active' } : null; }, async run() { savedCursor = value; } }; }, async first() { return { cursor: 'previous' }; } }; } };
  const bucket = { async list(options) { assert.equal(options.cursor, 'previous'); return { objects: [{ key: key('1'), uploaded: old }, { key: key('2'), uploaded: old }, { key: key('3'), uploaded: recent }, { key: 'scheduled/unrelated', uploaded: old }], truncated: true, cursor: 'next' }; }, async delete(value) { deleted.push(value); } };
  await cleanOrphanedScheduledPayloads(db, bucket, now);
  assert.deepEqual(deleted, [key('2')]);
  assert.equal(savedCursor, 'next');
});

test('orphan cleanup does not advance the cursor when deletion fails', async () => {
  let advanced = false;
  const db = { prepare(sql) { return { bind() { return { async first() { return null; }, async run() { advanced = true; } }; }, async first() { return { cursor: null }; } }; } };
  const bucket = { async list() { return { objects: [{ key: 'scheduled/00000000-0000-4000-8000-000000000001', uploaded: new Date(0) }], truncated: false }; }, async delete() { throw new Error('R2 failure'); } };
  await assert.rejects(cleanOrphanedScheduledPayloads(db, bucket, Date.now()));
  assert.equal(advanced, false);
});
