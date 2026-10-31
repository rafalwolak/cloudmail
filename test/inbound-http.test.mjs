import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTestOrigin } from './local-auth-mail.mjs';
import { injectReceivedFixture } from './received-fixture.mjs';

const base = localTestOrigin(process.env.TEST_BASE_URL || 'http://127.0.0.1:8787');
const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}` };

test('native Email Routing stores MIME in R2 before exposing private metadata and attachments', { skip: process.env.TEST_INBOUND !== 'true' }, async () => {
  const marker = await injectReceivedFixture(base);
  const listing = await fetch(`${base}/emails/receiving?subject=${encodeURIComponent(marker)}`, { headers });
  assert.equal(listing.status, 200);
  const list = await listing.json(); assert.equal(list.data.length, 1);
  const id = list.data[0].id;
  try {
    assert.equal((await fetch(`${base}/emails/receiving/${id}`)).status, 401);
    const response = await fetch(`${base}/emails/receiving/${id}`, { headers });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.from, 'bounce@example.net'); assert.equal(detail.to, 'inbox@example.com');
    assert.equal(detail.header_from.address, 'customer@example.com'); assert.equal(detail.reply_to[0].address, 'reply@example.com');
    assert.equal(detail.text.trim(), 'Synthetic inbound content');
    assert.equal(detail.attachments.length, 1); assert.equal(detail.attachments[0].size, 2);
    const file = await fetch(`${base}/emails/receiving/${id}/attachments/0`, { headers });
    assert.equal(file.status, 200); assert.match(file.headers.get('content-type'), /application\/octet-stream/);
    assert.match(file.headers.get('content-disposition'), /^attachment/); assert.equal(await file.text(), 'hi');
  } finally {
    const removed = await fetch(`${base}/emails/receiving/${id}`, { method: 'DELETE', headers });
    assert.equal(removed.status, 200);
  }
});
