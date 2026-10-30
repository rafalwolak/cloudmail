import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };

test('sent attachments are recorded and available only to authorized clients', async () => {
  const sent = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ from: 'sender@example.test', to: 'recipient@example.test', subject: 'Attachment test', text: 'Hello', attachments: [{ filename: 'report.txt', content: 'SGVsbG8=' }, { filename: 'logo.png', content: 'SGVsbG8=', content_id: 'logo@example.test' }] }) });
  assert.equal(sent.status, 200, await sent.clone().text());
  const { id } = await sent.json();
  const detail = await (await fetch(`${base}/emails/${id}`, { headers })).json();
  assert.deepEqual(detail.attachments, [{ id: '0', filename: 'report.txt', content_type: 'text/plain', content_disposition: 'attachment', content_id: null, size: 5 }, { id: '1', filename: 'logo.png', content_type: 'image/png', content_disposition: 'inline', content_id: 'logo@example.test', size: 5 }]);
  const path = `${base}/emails/${id}/attachments/0`;
  assert.equal((await fetch(path)).status, 401);
  const download = await fetch(path, { headers });
  assert.equal(download.status, 200); assert.equal(await download.text(), 'Hello');
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.equal(download.headers.get('content-disposition'), "attachment; filename*=UTF-8''report.txt");
  assert.equal((await fetch(`${base}/emails/${id}/attachments/2`, { headers })).status, 404);
  const client = new Client({ name: 'sent-attachment-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
    const result = await client.callTool({ name: 'get_sent_attachment', arguments: { id, index: 0 } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { content_base64: 'SGVsbG8=', size: 5 });
    assert.equal((await client.callTool({ name: 'get_sent_attachment', arguments: { id, index: 2 } })).isError, true);
  } finally { await client.close(); }
});
