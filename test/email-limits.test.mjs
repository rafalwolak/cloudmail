import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmail } from '../src/email.ts';
const message = { from: 'a@example.test', to: 'b@example.test', subject: 'Test', text: 'Hello' };

test('validates subject length and rejects line breaks', () => {
  assert.equal(typeof parseEmail({ ...message, subject: 'a'.repeat(998) }), 'object');
  assert.equal(typeof parseEmail({ ...message, subject: 'a'.repeat(999) }), 'string');
  assert.equal(typeof parseEmail({ ...message, subject: 'Test\r\nBcc: victim@example.test' }), 'string');
});

test('validates custom header names, values and UTF-8 byte size', () => {
  assert.equal(typeof parseEmail({ ...message, headers: { 'X-Example': 'value' } }), 'object');
  assert.equal(typeof parseEmail({ ...message, headers: { 'Bad Name': 'value' } }), 'string');
  assert.equal(typeof parseEmail({ ...message, headers: { 'X-Example': 'value\nInjected: x' } }), 'string');
  assert.equal(typeof parseEmail({ ...message, headers: { 'X-Example': 'ą'.repeat(8000) } }), 'string');
});
