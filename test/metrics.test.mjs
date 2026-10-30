import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';
const headers = { authorization: `Bearer ${key}` };
const sql = command => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', process.env.TEST_D1_CONFIG, '--command', command], { stdio: 'pipe' });

test('metrics count distinct recipient events, respect intervals and are available via MCP', { skip: !process.env.TEST_D1_CONFIG }, async () => {
  const id = crypto.randomUUID();
  const range = 'start_date=2031-01-01T00%3A00%3A00Z&end_date=2031-01-02T00%3A00%3A00Z';
  const client = new Client({ name: 'metrics-test', version: '1' });
  try {
    sql(`INSERT INTO email_history (id, sender, recipients, subject, status, created_at) VALUES ('${id}', 'sender@example.com', '["a@example.com"]', 'Test', 'accepted', '2031-01-01T01:00:00.000Z'); INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at) VALUES ('${id}-1', '${id}', 'A@example.com', 'delivered', '2031-01-01T02:00:00.000Z'), ('${id}-2', '${id}', 'a@example.com', 'delivered', '2031-01-01T03:00:00.000Z'), ('${id}-3', '${id}', 'b@example.com', 'bounced', '2031-01-01T04:00:00.000Z'), ('${id}-4', '${id}', 'c@example.com', 'delivered', '2031-01-02T00:00:00.000Z')`);
    const response = await fetch(`${base}/emails/metrics?${range}`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.totals.sent, 1);
    assert.equal(result.totals.delivered, 1);
    assert.equal(result.totals.bounced, 1);
    assert.equal(result.totals.complained, 0);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
    const mcp = await client.callTool({ name: 'get_email_metrics', arguments: { start_date: '2031-01-01T00:00:00Z', end_date: '2031-01-02T00:00:00Z' } });
    assert.notEqual(mcp.isError, true);
    assert.deepEqual(JSON.parse(mcp.content[0].text), result);
  } finally {
    await client.close();
    sql(`DELETE FROM delivery_events WHERE provider_id = '${id}'; DELETE FROM email_history WHERE id = '${id}'`);
  }
});

test('metrics reject invalid intervals and require authorization', async () => {
  assert.equal((await fetch(`${base}/emails/metrics`)).status, 401);
  for (const query of ['start_date=bad', 'start_date=2031-02-30T00:00:00Z', 'start_date=2031-01-02T00:00:00Z&end_date=2031-01-01T00:00:00Z', 'unknown=1']) {
    assert.equal((await fetch(`${base}/emails/metrics?${query}`, { headers })).status, 400);
  }
});
