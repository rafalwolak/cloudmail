import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';

test('AI catalog discovers the public MCP card without exposing credentials', async () => {
  const catalogResponse = await fetch(`${base}/.well-known/ai-catalog.json`);
  assert.equal(catalogResponse.status, 200);
  assert.match(catalogResponse.headers.get('content-type'), /^application\/ai-catalog\+json/);
  assert.equal(catalogResponse.headers.get('access-control-allow-origin'), '*');
  const catalog = await catalogResponse.json();
  assert.equal(catalog.specVersion, '1.0');
  assert.equal(catalog.entries[0].url, `${base}/mcp/server-card`);
  const response = await fetch(catalog.entries[0].url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/mcp-server-card\+json/);
  const card = await response.json();
  assert.equal(card.$schema, 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
  assert.equal(card.remotes[0].url, `${base}/mcp`);
  assert.equal(card.remotes[0].type, 'streamable-http');
  assert.deepEqual(card.remotes[0].supportedProtocolVersions, SUPPORTED_PROTOCOL_VERSIONS);
  assert.equal(card.remotes[0].headers[0].name, 'Authorization');
  assert.equal(card.remotes[0].headers[0].isSecret, true);
  assert.equal(card.remotes[0].headers[0].value, undefined);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(catalog.entries[0].url, { headers: { 'If-None-Match': etag } })).status, 304);
  const options = await fetch(catalog.entries[0].url, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.match(options.headers.get('access-control-allow-headers'), /If-None-Match/i);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST' })).status, 401);
});
