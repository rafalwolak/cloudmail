import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';

test('API key management requires a user session', async () => {
  const response = await fetch(`${base}/api/keys`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'test' }) });
  assert.equal(response.status, 401);
});

test('verified admin can create, use and revoke a key', { skip: process.env.TEST_KEYS !== 'true' }, async () => {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = 'a sufficiently long test password';
  const headers = { origin: base, 'content-type': 'application/json' };
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST', headers, body: JSON.stringify({ name: 'Admin', email, password }) });
  assert.equal(signup.status, 200, await signup.clone().text());
  async function files(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]))).flat();
  }
  const candidates = (await files('.wrangler/tmp/email')).filter(path => path.includes('/email-text/'));
  const timestamps = await Promise.all(candidates.map(async path => ({ path, time: (await stat(path)).mtimeMs })));
  timestamps.sort((a, b) => b.time - a.time);
  const text = await readFile(timestamps[0].path, 'utf8');
  const url = text.match(/http:\/\/127\.0\.0\.1:8787\/api\/auth\/verify-email\?[^\s]+/)?.[0];
  assert.ok(url, 'verification link is present in the simulated email');
  const verification = await fetch(url, { redirect: 'manual' });
  assert.ok([200, 302].includes(verification.status));
  const signin = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
  assert.equal(signin.status, 200, await signin.clone().text());
  const cookie = signin.headers.get('set-cookie').split(';')[0];
  const authHeaders = { ...headers, cookie };
  const create = await fetch(`${base}/api/keys`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'test' }) });
  assert.equal(create.status, 201, await create.clone().text());
  assert.equal(create.headers.get('cache-control'), 'no-store');
  const { id, token } = await create.json();
  const list = await fetch(`${base}/api/keys`, { headers: { cookie } });
  const listBody = await list.json();
  assert.equal(listBody.data[0].id, id);
  assert.ok(!JSON.stringify(listBody).includes(token));
  const send = () => fetch(`${base}/emails`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'a@example.com', to: 'b@example.com', subject: 'Hi', text: 'Hi' }) });
  assert.equal((await send()).status, 200);
  const csrf = await fetch(`${base}/api/keys/${id}`, { method: 'DELETE', headers: { cookie, origin: 'https://attacker.example' } });
  assert.equal(csrf.status, 403);
  const revoke = await fetch(`${base}/api/keys/${id}`, { method: 'DELETE', headers: { cookie, origin: base } });
  assert.equal(revoke.status, 204);
  assert.equal((await send()).status, 401);
});

test('sending-only keys cannot read data or manage resources', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = { cookie, origin: base, 'content-type': 'application/json' };
  const create = await fetch(`${base}/api/keys`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Limited test', permission: 'sending_access' }) });
  assert.equal(create.status, 201);
  const { id, token } = await create.json();
  try {
    const keyHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const list = await (await fetch(`${base}/api/keys`, { headers: { cookie } })).json();
    assert.equal(list.data.find(item => item.id === id).permission, 'sending_access');
    const body = { from: 'a@example.com', to: 'b@example.com', subject: 'Hi', text: 'Hi' };
    assert.equal((await fetch(`${base}/emails`, { method: 'POST', headers: keyHeaders, body: JSON.stringify(body) })).status, 200);
    assert.equal((await fetch(`${base}/emails/batch`, { method: 'POST', headers: keyHeaders, body: JSON.stringify([body]) })).status, 200);
    for (const path of ['/emails', '/emails/metrics', '/templates', '/webhooks', '/domains']) assert.equal((await fetch(`${base}${path}`, { headers: keyHeaders })).status, 403);
    assert.equal((await fetch(`${base}/templates`, { method: 'POST', headers: keyHeaders, body: '{}' })).status, 403);
    const client = new Client({ name: 'limited-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['send_batch', 'send_email']);
      const batch = await client.callTool({ name: 'send_batch', arguments: { emails: [body] } });
      assert.notEqual(batch.isError, true);
      const sent = await client.callTool({ name: 'send_email', arguments: body });
      assert.notEqual(sent.isError, true);
      for (const name of ['list_emails', 'get_email', 'create_template', 'cancel_email', 'create_api_key', 'list_api_keys', 'delete_api_key', 'list_received_emails', 'get_received_email', 'delete_received_email', 'create_webhook', 'list_webhooks', 'delete_webhook', 'replay_webhook_delivery', 'update_webhook', 'rotate_webhook_secret']) {
        try { const result = await client.callTool({ name, arguments: {} }); assert.equal(result.isError, true); }
        catch (error) { assert.match(String(error), /not found|unknown|not registered/i); }
      }
    } finally { await client.close(); }
    assert.equal((await fetch(`${base}/api/keys/${id}`, { method: 'DELETE', headers: admin })).status, 204);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: keyHeaders, body: '{}' })).status, 401);
  } finally { await fetch(`${base}/api/keys/${id}`, { method: 'DELETE', headers: admin }); }
});

test('domain-scoped keys enforce the sender for HTTP, templates, batch and MCP', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = { cookie, origin: base, 'content-type': 'application/json' };
  const create = await fetch(`${base}/api/keys`, { method: 'POST', headers: admin, body: JSON.stringify({ name: 'Domain test', permission: 'sending_access', sending_domain: 'EXAMPLE.COM' }) });
  assert.equal(create.status, 201);
  const { id, token } = await create.json();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const msg = { from: 'hello@example.com', to: 'b@example.com', subject: 'Hi', text: 'Hi' };
  try {
    const list = await (await fetch(`${base}/api/keys`, { headers: { cookie } })).json();
    assert.equal(list.data.find(item => item.id === id).sending_domain, 'example.com');
    const send = body => fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await send(msg)).status, 200);
    for (const from of ['hello@other.com', 'hello@sub.example.com', 'hello@example.com,evil@other.com', 'hello@other.com <hello@example.com>']) assert.equal((await send({ ...msg, from })).status, 403);
    assert.equal((await send({ ...msg, headers: { From: 'evil@other.com' } })).status, 403);
    assert.equal((await fetch(`${base}/emails/batch`, { method: 'POST', headers, body: JSON.stringify([msg, { ...msg, from: 'hello@other.com' }]) })).status, 403);
    const fullHeaders = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };
    const template = await fetch(`${base}/templates`, { method: 'POST', headers: fullHeaders, body: JSON.stringify({ name: 'Restricted sender', from: 'hello@other.com', subject: 'Hi', html: '<p>Hi</p>' }) });
    const templateId = (await template.json()).id;
    try {
      assert.equal((await fetch(`${base}/templates/${templateId}/publish`, { method: 'POST', headers: fullHeaders })).status, 200);
      assert.equal((await send({ to: msg.to, template: { id: templateId } })).status, 403);
    } finally { await fetch(`${base}/templates/${templateId}`, { method: 'DELETE', headers: fullHeaders }); }

    const client = new Client({ name: 'domain-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      assert.equal((await client.callTool({ name: 'send_email', arguments: { ...msg, from: 'hello@other.com' } })).isError, true);
      assert.equal((await client.callTool({ name: 'send_batch', arguments: { emails: [msg, { ...msg, from: 'hello@other.com' }] } })).isError, true);
    } finally { await client.close(); }
  } finally { await fetch(`${base}/api/keys/${id}`, { method: 'DELETE', headers: admin }); }
});

test('full-access API keys can manage keys through REST and MCP', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const full = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };
  const create = await fetch(`${base}/api-keys`, { method: 'POST', headers: full, body: JSON.stringify({ name: 'API key test', permission: 'sending_access', sending_domain: 'example.com' }) });
  assert.equal(create.status, 201, await create.clone().text());
  const { id, token } = await create.json(); assert.match(token, /^clm_/);
  const list = await fetch(`${base}/api-keys`, { headers: full }); assert.equal(list.status, 200);
  assert.equal((await list.json()).data.find(item => item.id === id).sending_domain, 'example.com');
  assert.equal((await fetch(`${base}/api-keys`, { headers: { authorization: `Bearer ${token}` } })).status, 403);
  const client = new Client({ name: 'key-management-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: full } }));
    const tools = await client.listTools();
    for (const name of ['create_api_key', 'list_api_keys', 'delete_api_key']) assert.ok(tools.tools.some(tool => tool.name === name));
    const createdByMcp = await client.callTool({ name: 'create_api_key', arguments: { name: 'MCP scoped test', permission: 'sending_access' } });
    assert.notEqual(createdByMcp.isError, true);
    const mcpKey = JSON.parse(createdByMcp.content[0].text);
    assert.match(mcpKey.token, /^clm_/);
    assert.notEqual((await client.callTool({ name: 'delete_api_key', arguments: { id: mcpKey.id } })).isError, true);
    const listed = await client.callTool({ name: 'list_api_keys', arguments: {} });
    assert.ok(JSON.parse(listed.content[0].text).data.some(item => item.id === id));
    const deleted = await client.callTool({ name: 'delete_api_key', arguments: { id } });
    assert.notEqual(deleted.isError, true);
    assert.equal((await fetch(`${base}/emails`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
  } finally { await client.close(); await fetch(`${base}/api-keys/${id}`, { method: 'DELETE', headers: full }); }
});
