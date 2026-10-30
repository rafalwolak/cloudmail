import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPlainText } from '../src/plain-text.ts';

test('generates readable text from HTML while preserving explicit text', () => {
  const email = { from: 'sender@example.test', to: 'recipient@example.test', subject: 'Hello', html: '<p>Hello &amp; welcome.</p><p><a href="https://example.test/order">View order</a></p><script>ignore this</script>' };
  const generated = withPlainText(email);
  assert.match(generated.text, /Hello & welcome/);
  assert.match(generated.text, /View order/);
  assert.match(generated.text, /https:\/\/example\.test\/order/);
  assert.doesNotMatch(generated.text, /ignore this/);
  assert.equal(withPlainText({ ...email, text: '' }).text, '');
  assert.equal(withPlainText({ ...email, text: 'Custom' }).text, 'Custom');
});
