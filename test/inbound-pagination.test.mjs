import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const token = process.env.TEST_API_KEY || 'local-test-key';
const sql = command => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--command', command], { stdio: 'pipe' });

test('received email pages are stable in both directions and accessible through MCP', { skip: !process.env.TEST_D1_CONFIG }, async () => {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID()).sort();
  sql(ids.map(id => `INSERT INTO inbound_emails (id, sender, recipient, subject, created_at, object_key) VALUES ('${id}', 'a@example.com', 'b@example.com', 'Pagination', '2030-01-01T00:00:00.000Z', 'test/${id}')`).join(';'));
  const headers = { authorization: `Bearer ${token}` };
  const get = query => fetch(`${base}/emails/receiving?${query}`, { headers });
  const client = new Client({ name: 'inbox-pagination-test', version: '1.0.0' });
  try {
    const first = await (await get('limit=2')).json();
    assert.deepEqual(first.data.map(item => item.id), [ids[3], ids[2]]); assert.equal(first.has_more, true);
    const second = await (await get(`limit=2&after=${ids[2]}`)).json();
    assert.deepEqual(second.data.map(item => item.id), [ids[1], ids[0]]);
    const previous = await (await get(`limit=2&before=${ids[1]}`)).json();
    assert.deepEqual(previous.data.map(item => item.id), [ids[3], ids[2]]);
    assert.equal((await get('after=missing')).status, 400);
    assert.equal((await get(`after=${ids[0]}&before=${ids[1]}`)).status, 400);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
    const mcp = await client.callTool({ name: 'list_received_emails', arguments: { limit: 2, after: ids[2] } });
    assert.deepEqual(JSON.parse(mcp.content[0].text).data.map(item => item.id), [ids[1], ids[0]]);
  } finally { await client.close(); sql(`DELETE FROM inbound_emails WHERE id IN (${ids.map(id => `'${id}'`).join(',')})`); }
});
