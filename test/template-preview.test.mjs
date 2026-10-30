import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewTemplate, previewToken } from '../src/template-preview.ts';
const token = 'a'.repeat(64);
const request = body => new Request('https://example.com/api/template-preview', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });

test('preview retains inline HTML while enforcing a sandbox and disabling network access', async () => {
  const html = '<p style="color:red">Hello</p><script>alert(1)</script>';
  const response = await previewTemplate(request(new URLSearchParams({ html, token }).toString()), token);
  assert.equal(response.status, 200); assert.equal(await response.text(), html);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /style-src 'unsafe-inline'/);
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.match(response.headers.get('content-security-policy'), /form-action 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('preview rejects malformed, oversized and duplicated inputs', async () => {
  assert.equal((await previewTemplate(request('html=a&token=wrong'), token)).status, 403);
  assert.equal((await previewTemplate(request(`html=a&html=b&token=${token}`), token)).status, 400);
  assert.equal((await previewTemplate(request(`html=${'a'.repeat(200001)}&token=${token}`), token)).status, 400);
  assert.equal((await previewTemplate(request(`html=${'a'.repeat(3000001)}&token=${token}`), token)).status, 413);
  assert.equal((await previewTemplate(new Request('https://example.com/api/template-preview', { method: 'POST', body: '{}' }), token)).status, 415);
});


test('preview tokens differ between sessions and signing secrets', async () => {
  const first = await previewToken('a'.repeat(64), 'session-1');
  assert.equal(first, await previewToken('a'.repeat(64), 'session-1'));
  assert.notEqual(first, await previewToken('a'.repeat(64), 'session-2'));
  assert.notEqual(first, await previewToken('b'.repeat(64), 'session-1'));
});
