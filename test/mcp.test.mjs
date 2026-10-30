import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';

test('MCP requires authentication', async () => {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
  assert.equal(response.status, 401);
});

test('MCP client discovers and calls the transactional send tool', async () => {
  const client = new Client({ name: 'cloudmail-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === 'send_email'));
    assert.ok(tools.tools.some(tool => tool.name === 'list_emails'));
    assert.ok(tools.tools.some(tool => tool.name === 'get_email'));
    const result = await client.callTool({ name: 'send_email', arguments: { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Test', text: 'Hello' } });
    assert.notEqual(result.isError, true);
    const id = JSON.parse(result.content[0].text).id;
    assert.ok(id);
    const history = await fetch(`${base}/emails/${id}`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal((await history.json()).status, 'accepted');
    const retrieved = await client.callTool({ name: 'get_email', arguments: { id } });
    assert.equal(JSON.parse(retrieved.content[0].text).id, id);
    const listed = await client.callTool({ name: 'list_emails', arguments: { limit: 10 } });
    assert.ok(JSON.parse(listed.content[0].text).data.some(item => item.id === id));
    const idemArgs = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'MCP idempotency', text: 'Hello', idempotency_key: crypto.randomUUID() };
    const first = await client.callTool({ name: 'send_email', arguments: idemArgs });
    const again = await client.callTool({ name: 'send_email', arguments: idemArgs });
    assert.notEqual(first.isError, true);
    assert.equal(JSON.parse(first.content[0].text).id, JSON.parse(again.content[0].text).id);
    const created = await fetch(`${base}/templates`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'MCP', from: 'sender@example.com', subject: 'MCP template', html: '<p>Hi</p>' }) });
    const templateId = (await created.json()).id;
    await fetch(`${base}/templates/${templateId}/publish`, { method: 'POST', headers: { authorization: `Bearer ${key}` } });
    const templated = await client.callTool({ name: 'send_email', arguments: { to: 'recipient@example.com', template: { id: templateId } } });
    assert.notEqual(templated.isError, true);
    await fetch(`${base}/templates/${templateId}`, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } });
    const invalid = await client.callTool({ name: 'send_email', arguments: { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Test', text: 'Hello', scheduled_at: '2027-01-01' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});


test('MCP rejects requests from an untrusted browser origin', async () => {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${key}`, origin: 'https://attacker.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(response.status, 403);
});

test('MCP manages template drafts and published versions', async () => {
  const client = new Client({ name: 'template-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map(tool => tool.name);
    for (const name of ['create_template', 'list_templates', 'get_template', 'update_template', 'publish_template', 'duplicate_template', 'delete_template']) assert.ok(names.includes(name));
    assert.equal(tools.tools.find(tool => tool.name === 'delete_template').annotations.destructiveHint, true);
    const create = await client.callTool({ name: 'create_template', arguments: { name: 'MCP draft', html: '<p>Hello</p>' } });
    assert.notEqual(create.isError, true);
    const { id } = JSON.parse(create.content[0].text);
    const list = await client.callTool({ name: 'list_templates', arguments: {} });
    assert.ok(JSON.parse(list.content[0].text).data.some(item => item.id === id));
    const update = await client.callTool({ name: 'update_template', arguments: { id, changes: { subject: 'Updated' } } });
    assert.notEqual(update.isError, true);
    const publish = await client.callTool({ name: 'publish_template', arguments: { id } });
    assert.notEqual(publish.isError, true);
    const get = await client.callTool({ name: 'get_template', arguments: { id } });
    const item = JSON.parse(get.content[0].text);
    assert.equal(item.status, 'published');
    assert.equal(item.subject, 'Updated');
    const copy = await client.callTool({ name: 'duplicate_template', arguments: { id } });
    assert.notEqual(copy.isError, true);
    const copyId = JSON.parse(copy.content[0].text).id;
    const page = await client.callTool({ name: 'list_templates', arguments: { limit: 1 } });
    assert.equal(JSON.parse(page.content[0].text).data.length, 1);
    await client.callTool({ name: 'delete_template', arguments: { id: copyId } });
    const remove = await client.callTool({ name: 'delete_template', arguments: { id } });
    assert.equal(JSON.parse(remove.content[0].text).deleted, true);
    const missing = await client.callTool({ name: 'get_template', arguments: { id } });
    assert.equal(missing.isError, true);
  } finally { await client.close(); }
});
