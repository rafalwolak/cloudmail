import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentId, attachmentIndex } from '../src/attachment-id.ts';

const email = '11111111-1111-4111-8111-111111111111';
test('attachment UUIDs are stable, reversible and scoped to the message and direction', async () => {
  for (const index of [0, 1, 100, 65536, 0xffffffff]) {
    const id = await attachmentId('sending', email, index);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(await attachmentId('sending', email, index), id);
    assert.equal(await attachmentIndex('sending', email, id.toUpperCase()), index);
    assert.equal(await attachmentIndex('receiving', email, id), null);
    assert.equal(await attachmentIndex('sending', '22222222-2222-4222-8222-222222222222', id), null);
    const changed = `${id.slice(0, -1)}${id.endsWith('0') ? '1' : '0'}`;
    assert.equal(await attachmentIndex('sending', email, changed), null);
  }
});
test('attachment UUID decoding rejects legacy indexes and generation rejects invalid indexes', async () => {
  for (const id of ['0', '../0', '', crypto.randomUUID(), '0'.repeat(36)]) assert.equal(await attachmentIndex('sending', email, id), null);
  for (const index of [-1, 0.5, 0x100000000, NaN]) await assert.rejects(attachmentId('sending', email, index), RangeError);
});
