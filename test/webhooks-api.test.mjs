import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };

test('webhook API creates private secrets, enqueues delivery events and exposes MCP tools', { skip: !process.env.TEST_D1_CONFIG }, async () => {
  assert.equal((await fetch(`${base}/webhooks`)).status, 401);
  const create = await fetch(`${base}/webhooks`, { method: 'POST', headers, body: JSON.stringify({ endpoint: 'https://hooks.example.com/events', events: ['email.delivered'] }) });
  assert.equal(create.status, 201, await create.clone().text());
  const { id, signing_secret } = await create.json(); assert.match(signing_secret, /^whsec_/);
  const eventId = crypto.randomUUID();
  const client = new Client({ name: 'webhooks-test', version: '1.0.0' });
  try {
    const list = await (await fetch(`${base}/webhooks`, { headers })).json();
    assert.ok(list.data.some(item => item.id === id)); assert.ok(!JSON.stringify(list).includes(signing_secret));
    assert.equal((await fetch(`${base}/webhooks`, { method: 'POST', headers, body: JSON.stringify({ endpoint: 'http://localhost', events: ['email.delivered'] }) })).status, 400);
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--command', `INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at) VALUES ('${eventId}', 'test-provider', 'recipient@example.com', 'delivered', '2026-10-30T10:00:00.000Z')`], { stdio: 'pipe' });
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--json', '--command', `SELECT webhook_id, event_id, state FROM webhook_deliveries WHERE webhook_id = '${id}' AND event_id = '${eventId}'`], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out)[0].results, [{ webhook_id: id, event_id: eventId, state: 'pending' }]);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
    const tools = await client.listTools(); for (const name of ['list_webhooks', 'create_webhook', 'get_webhook', 'delete_webhook']) assert.ok(tools.tools.some(tool => tool.name === name));
    const fetched = await client.callTool({ name: 'get_webhook', arguments: { id } }); assert.equal(JSON.parse(fetched.content[0].text).id, id);
  } finally {
    await client.close();
    await fetch(`${base}/webhooks/${id}`, { method: 'DELETE', headers });
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--command', `DELETE FROM delivery_events WHERE id = '${eventId}'`], { stdio: 'pipe' });
  }
});
