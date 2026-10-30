import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSentContent, storeSentContent } from '../src/sent-content.ts';

test('stores only email bodies and reads them from the private bucket', async () => {
  const objects = new Map();
  const bucket = {
    async put(key, value) { objects.set(key, value); },
    async get(key) { const value = objects.get(key); return value === undefined ? null : { async json() { return JSON.parse(value); } }; },
  };
  await storeSentContent(bucket, '123', { from: 'a@example.test', to: 'b@example.test', subject: 'Test', text: 'Hello', attachments: [{ content: 'secret' }] });
  assert.deepEqual(await readSentContent(bucket, '123'), { html: null, text: 'Hello' });
  assert.equal(objects.get('sent/123').includes('secret'), false);
  assert.equal(await readSentContent(bucket, 'missing'), null);
  objects.set('sent/bad', '{"html":42,"text":null}');
  await assert.rejects(readSentContent(bucket, 'bad'));
});
