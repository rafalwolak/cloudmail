import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSentContent, storeSentContent } from '../src/sent-content.ts';

test('stores sent attachment content and reads legacy body-only objects', async () => {
  const objects = new Map();
  const bucket = {
    async put(key, value) { objects.set(key, value); },
    async get(key) { const value = objects.get(key); return value === undefined ? null : { async json() { return JSON.parse(value); } }; },
  };
  const attachment = { filename: 'report.txt', content: 'SGVsbG8=', type: 'text/plain', disposition: 'attachment' };
  await storeSentContent(bucket, '123', { from: 'a@example.test', to: 'b@example.test', subject: 'Test', text: 'Hello', attachments: [attachment] });
  assert.deepEqual(await readSentContent(bucket, '123'), { html: null, text: 'Hello', attachments: [attachment] });
  objects.set('sent/old', '{"html":null,"text":"Old"}');
  assert.deepEqual(await readSentContent(bucket, 'old'), { html: null, text: 'Old', attachments: null });
  assert.equal(await readSentContent(bucket, 'missing'), null);
  objects.set('sent/bad', '{"html":42,"text":null}');
  await assert.rejects(readSentContent(bucket, 'bad'));
});
