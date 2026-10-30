import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentList } from '../src/attachment-list.ts';

test('attachment pages validate cursors and navigate in both directions', async () => {
  const list = query => attachmentList(['a', 'b', 'c'], new URLSearchParams(query));
  assert.deepEqual(await (list('limit=1')).json(), { object: 'list', data: ['a'], has_more: true });
  assert.deepEqual(await (list('limit=1&after=0')).json(), { object: 'list', data: ['b'], has_more: true });
  assert.deepEqual(await (list('limit=1&before=2')).json(), { object: 'list', data: ['b'], has_more: true });
  for (const query of ['after=3', 'before=00', 'after=0&before=1', 'limit=0', 'after=0&after=1', 'extra=1']) assert.equal(list(query).status, 400);
});
