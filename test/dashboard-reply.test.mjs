import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyDraft } from '../public/dashboard-reply.js';

const received = { header_from: { name: 'Customer', address: 'customer@example.com' }, from: 'bounce@example.net', to: 'support@example.com', subject: 'Invoice question', message_id: '<current@example.com>', references: '<first@example.com> <previous@example.com>', cc: [{ address: 'private@example.com' }], text: 'Private original content', attachments: [{ filename: 'private.txt' }] };

test('reply draft uses Reply-To mailboxes and carries only intended message fields', () => {
  const draft = replyDraft({ ...received, reply_to: [{ name: '<script>untrusted</script>', group: [{ address: 'reply@example.com' }, { address: 'reply@example.com' }] }] });
  assert.deepEqual(draft.to, ['reply@example.com']);
  assert.equal(draft.subject, 'Re: Invoice question');
  assert.deepEqual(draft.headers, { 'In-Reply-To': '<current@example.com>', References: '<first@example.com> <previous@example.com> <current@example.com>' });
  for (const key of ['from', 'text', 'html', 'cc', 'bcc', 'attachments']) assert.equal(draft[key], undefined);
  assert.deepEqual(replyDraft({ ...received, reply_to: [] }).to, ['customer@example.com']);
});

test('reply draft rejects unsafe, malformed or excessive recipient headers without envelope fallback', () => {
  for (const reply_to of [[{ address: 'safe@example.com\r\nBcc:attacker@example.com' }], [{ address: 'Display <a@example.com>' }], [{ group: [{ address: 'bad' }] }], Array.from({ length: 51 }, () => ({ address: 'a@example.com' }))]) assert.throws(() => replyDraft({ ...received, reply_to }), /reply address/i);
  assert.throws(() => replyDraft({ ...received, header_from: null }), /reply address/i);
});

test('unsafe or absent message IDs do not become outgoing headers', () => {
  for (const message_id of [null, '<id@example.com>\r\nBcc:attacker@example.com', 'not-a-message-id']) {
    const draft = replyDraft({ ...received, message_id });
    assert.deepEqual(draft.headers, {});
    assert.match(draft.note, /Threading is unavailable/);
  }
  const draft = replyDraft({ ...received, references: '<first@example.com>\r\nBcc: attacker@example.com' });
  assert.deepEqual(draft.headers, { 'In-Reply-To': '<current@example.com>', References: '<current@example.com>' });
  assert.match(draft.note, /references were omitted/);
});

test('references unfold and retain recent complete IDs within the API header limit', () => {
  assert.equal(replyDraft({ ...received, references: '<first@example.com>\r\n\t<previous@example.com>' }).headers.References, '<first@example.com> <previous@example.com> <current@example.com>');
  const draft = replyDraft({ ...received, references: Array.from({ length: 100 }, (_, index) => `<message-${index}@example.com>`).join(' ') });
  assert.ok(Buffer.byteLength(draft.headers.References) <= 2048);
  assert.ok(draft.headers.References.endsWith('<message-99@example.com> <current@example.com>'));
  assert.match(draft.note, /references were omitted/);
});

test('reply subjects avoid repeated prefixes and stay within the existing subject limit', () => {
  assert.equal(replyDraft({ ...received, subject: 'Re: Invoice question' }).subject, 'Re: Invoice question');
  assert.equal(replyDraft({ ...received, subject: null }).subject, 'Re: (No subject)');
  const draft = replyDraft({ ...received, subject: 'x'.repeat(3000) });
  assert.equal([...draft.subject].length, 998); assert.match(draft.note, /Subject was shortened/);
  assert.equal(replyDraft({ ...received, subject: 'Invoice\r\nquestion' }).subject, 'Re: Invoice question');
});
