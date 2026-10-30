import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmail } from '../src/email.ts';

const message = { from: 'a@example.com', to: 'b@example.com', subject: 'Hello', text: 'Hi' };

test('maps base64 and inline attachments to Cloudflare format', () => {
  const result = parseEmail({ ...message, attachments: [
    { filename: 'note.txt', content: 'aGVsbG8=', content_type: 'text/plain' },
    { filename: 'logo.png', content: 'aGk=', content_id: 'logo', content_type: 'image/png' },
  ] });
  assert.deepEqual(result.attachments, [
    { filename: 'note.txt', content: 'aGVsbG8=', type: 'text/plain', disposition: 'attachment' },
    { filename: 'logo.png', content: 'aGk=', type: 'image/png', disposition: 'inline', contentId: 'logo' },
  ]);
});

test('rejects invalid, remote or excessive attachments', () => {
  for (const attachments of [
    [{ filename: 'file', content: 'not base64!' }],
    [{ filename: 'file', path: 'https://example.com/file' }],
    Array(33).fill({ filename: 'file', content: 'aGk=' }),
    [{ filename: 'file', content: 'aGk=', extra: true }],
  ]) assert.equal(typeof parseEmail({ ...message, attachments }), 'string');
});

test('infers attachment MIME types when not supplied and preserves explicit values', () => {
  const result = parseEmail({ ...message, attachments: [
    { filename: 'document.PDF', content: 'aGk=' },
    { filename: 'image.png', content: 'aGk=' },
    { filename: 'unknown.unlistedextension', content: 'aGk=' },
    { filename: 'document.pdf', content: 'aGk=', content_type: 'text/plain' },
  ] });
  assert.deepEqual(result.attachments.map(item => item.type), ['application/pdf', 'image/png', 'application/octet-stream', 'text/plain']);
});
