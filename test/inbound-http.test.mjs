import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
  let downloadUrl;
  try {
    assert.equal((await fetch(`${base}/emails/receiving/${id}`)).status, 401);
    const response = await fetch(`${base}/emails/receiving/${id}`, { headers });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.ok(detail.raw);
    const rawUrl = new URL(detail.raw.download_url); downloadUrl = rawUrl;
    assert.equal(rawUrl.origin, base);
    assert.ok(Date.parse(detail.raw.expires_at) > Date.now());
    assert.ok(Date.parse(detail.raw.expires_at) <= Date.now() + 5 * 60 * 1000);
    const raw = await fetch(rawUrl);
    assert.equal(raw.status, 200); assert.match(raw.headers.get('content-type'), /application\/octet-stream/);
    assert.match(raw.headers.get('content-disposition'), /\.eml"$/);
    assert.match(raw.headers.get('cache-control'), /no-store/);
    assert.equal(raw.headers.get('referrer-policy'), 'no-referrer');
    const mime = await raw.text();
    assert.ok(mime.includes(`Message-ID: <${marker}@example.com>`)); assert.ok(mime.includes('aGk='));
    const head = await fetch(rawUrl, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const altered = new URL(rawUrl); altered.searchParams.delete('signature');
    assert.equal((await fetch(altered)).status, 403);
    assert.equal((await fetch(rawUrl, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}${rawUrl.pathname}`, { headers })).status, 403);
    const client = new Client({ name: 'local-raw-download-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
      const result = await client.callTool({ name: 'get_received_email', arguments: { id } });
      assert.notEqual(result.isError, true);
      const metadata = JSON.parse(result.content[0].text);
      const fromMcp = new URL(metadata.raw.download_url);
      assert.equal(fromMcp.origin, base); assert.equal(fromMcp.pathname, rawUrl.pathname);
      assert.equal((await fetch(fromMcp, { method: 'HEAD' })).status, 200);
    } finally { await client.close(); }
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
    const deleted = await fetch(`${base}/emails/receiving/${id}`, { headers });
    assert.equal(deleted.status, 404);
    if (downloadUrl) assert.equal((await fetch(downloadUrl)).status, 404);
  }
});
