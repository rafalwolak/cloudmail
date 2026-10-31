import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { localTestOrigin } from './local-auth-mail.mjs';
import { injectReceivedFixture } from './received-fixture.mjs';

const source = JSON.parse(await readFile(new URL('../public/openapi.json', import.meta.url), 'utf8'));
const spec = await SwaggerParser.validate(structuredClone(source), { resolve: { external: false, file: false, http: false } });
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
const base = localTestOrigin(process.env.TEST_BASE_URL || 'http://127.0.0.1:8787');
const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };
function matches(schema, body) {
  const validate = ajv.compile(schema);
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
}
async function contract(path, method, template, status = 200, body) {
  const response = await fetch(`${base}${path}`, { method: method.toUpperCase(), headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `${method.toUpperCase()} ${template}`);
  if (status === 204) { assert.equal(await response.text(), ''); return null; }
  const payload = await response.json();
  const schema = spec.paths[template][method].responses[String(status)].content['application/json'].schema;
  matches(schema, payload);
  return payload;
}

test('OpenAPI document is valid, self-contained, relocatable and explicit about key permissions', () => {
  assert.equal(source.openapi, '3.1.1'); assert.deepEqual(source.servers.map(server => server.url), ['/']);
  assert.equal(Object.keys(source.paths).length, 34);
  const operations = Object.values(source.paths).flatMap(path => Object.values(path));
  assert.equal(operations.length, 50); assert.equal(new Set(operations.map(op => op.operationId)).size, 50);
  for (const [path, item] of Object.entries(source.paths)) for (const [method, operation] of Object.entries(item)) {
    assert.deepEqual(operation['x-cloudmail-permissions'], path.startsWith('/downloads/') ? [] : method === 'post' && ['/emails', '/emails/batch'].includes(path) ? ['full_access', 'sending_access'] : ['full_access']);
    for (const name of path.matchAll(/\{([^}]+)\}/g)) assert.ok(operation.parameters?.some(param => param.in === 'path' && param.name === name[1] && param.required));
  }
  function visit(value) { if (!value || typeof value !== 'object') return; if (value.$ref) assert.ok(value.$ref.startsWith('#/')); Object.values(value).forEach(visit); }
  visit(source);
  assert.equal(source.paths['/api/auth/sign-in/email'], undefined);
});

test('OpenAPI request models cover manual/template alternatives, batch scheduling and key domains', () => {
  const validate = ajv.compile(spec.components.schemas.EmailInput);
  assert.equal(validate({ from: 'sender@example.com', to: ['recipient@example.com'], subject: 'Hi', html: '<p>Hi</p>', tags: [{ name: 'type', value: 'receipt' }] }), true);
  assert.equal(validate({ to: 'recipient@example.com', template: { id: 'receipt', variables: { NAME: 'Alex' } } }), true);
  assert.equal(validate({ to: 'recipient@example.com', template: { id: 'receipt' }, html: '<p>Hi</p>' }), false);
  assert.equal(validate({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'Hi' }), false);
  assert.equal(validate({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'Hi', text: 'Hi', unexpected: true }), false);
  assert.equal(ajv.compile(spec.components.schemas.BatchEmailInput)({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'Hi', text: 'Hi', scheduled_at: 'in 1 min' }), false);
  const key = ajv.compile(spec.components.schemas.ApiKeyInput);
  assert.equal(key({ name: 'Scoped', sending_domain: 'example.com' }), false);
  assert.equal(key({ name: 'Scoped', permission: 'sending_access', sending_domain: 'example.com' }), true);
});

test('OpenAPI is public with safe discovery, CORS, HEAD, OPTIONS and method handling', async () => {
  const response = await fetch(`${base}/openapi.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), source);
  const head = await fetch(`${base}/openapi.json`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const preflight = await fetch(`${base}/openapi.json`, { method: 'OPTIONS' }); assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const denied = await fetch(`${base}/openapi.json`, { method: 'POST', body: '{}' }); assert.equal(denied.status, 405); assert.equal(denied.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.match((await fetch(base)).headers.get('link'), /<\/openapi.json>; rel="service-desc"/);
  assert.equal((await fetch(`${base}/emails`)).status, 401);
});

test('real email, schedule, attachment, metrics and template responses conform to OpenAPI', async () => {
  const input = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'OpenAPI synthetic contract', html: '<p>Hi</p>', tags: [{ name: 'type', value: 'contract' }], attachments: [{ filename: 'test.txt', content: 'aGk=' }] };
  const sent = await contract('/emails', 'post', '/emails', 200, input);
  const detail = await contract(`/emails/${sent.id}`, 'get', '/emails/{email_id}');
  assert.equal(detail.status, 'accepted');
  await contract('/emails?limit=1', 'get', '/emails');
  await contract(`/emails/${sent.id}/events`, 'get', '/emails/{email_id}/events');
  await contract(`/emails/${sent.id}/attachments`, 'get', '/emails/{email_id}/attachments');
  const batch = await contract('/emails/batch', 'post', '/emails/batch', 200, [input]); assert.equal(batch.data.length, 1);
  await contract('/emails/metrics?dimensions=period', 'get', '/emails/metrics');
  const scheduled = await contract('/emails', 'post', '/emails', 200, { ...input, scheduled_at: 'in 20 min' });
  await contract(`/emails/${scheduled.id}`, 'patch', '/emails/{email_id}', 200, { scheduled_at: 'in 30 min' });
  await contract(`/emails/${scheduled.id}/cancel`, 'post', '/emails/{email_id}/cancel');
  await contract(`/emails/${scheduled.id}`, 'get', '/emails/{email_id}');
  const template = await contract('/templates', 'post', '/templates', 200, { name: 'Contract template', html: '<p>Hello {{{NAME}}}</p>', variables: [{ key: 'NAME', type: 'string', fallback_value: 'Alex' }] });
  let copy;
  try {
    await contract(`/templates/${template.id}`, 'get', '/templates/{template_id}');
    await contract(`/templates/${template.id}`, 'patch', '/templates/{template_id}', 200, { subject: 'Updated' });
    await contract(`/templates/${template.id}/publish`, 'post', '/templates/{template_id}/publish');
    copy = await contract(`/templates/${template.id}/duplicate`, 'post', '/templates/{template_id}/duplicate');
    await contract('/templates?limit=1', 'get', '/templates');
  } finally {
    if (copy) await contract(`/templates/${copy.id}`, 'delete', '/templates/{template_id}');
    await contract(`/templates/${template.id}`, 'delete', '/templates/{template_id}');
  }
});

test('real webhook configuration and saved-event responses conform to OpenAPI', async () => {
  const hook = await contract('/webhooks', 'post', '/webhooks', 201, { endpoint: 'https://hooks.example.invalid/receive', events: ['email.sent'] });
  try {
    await contract(`/webhooks/${hook.id}`, 'get', '/webhooks/{webhook_id}');
    await contract('/webhooks?limit=1', 'get', '/webhooks');
    await contract(`/webhooks/${hook.id}`, 'patch', '/webhooks/{webhook_id}', 200, { status: 'enabled' });
    await contract('/emails', 'post', '/emails', 200, { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Synthetic saved event', text: 'Hi' });
    const events = await contract(`/webhooks/${hook.id}/events`, 'get', '/webhooks/{webhook_id}/events');
    assert.ok(events.data.length);
    const id = events.data[0].id;
    await contract(`/webhooks/${hook.id}/events/${id}`, 'get', '/webhooks/{webhook_id}/events/{event_id}');
    await contract(`/webhooks/${hook.id}/events/${id}/attempts`, 'get', '/webhooks/{webhook_id}/events/{event_id}/attempts');
    await contract(`/webhooks/${hook.id}/deliveries`, 'get', '/webhooks/{webhook_id}/deliveries');
    await contract(`/webhooks/${hook.id}/deliveries/${id}`, 'get', '/webhooks/{webhook_id}/deliveries/{delivery_id}');
    await contract(`/webhooks/${hook.id}/deliveries/${id}/attempts`, 'get', '/webhooks/{webhook_id}/deliveries/{delivery_id}/attempts');
    await contract(`/webhooks/${hook.id}/deliveries/${id}/replay`, 'post', '/webhooks/{webhook_id}/deliveries/{delivery_id}/replay', 201);
    await contract(`/webhooks/${hook.id}/events/${id}/replay`, 'post', '/webhooks/{webhook_id}/events/{event_id}/replay', 422);
    await contract(`/webhooks/${hook.id}/rotate-secret`, 'post', '/webhooks/{webhook_id}/rotate-secret');
  } finally { await contract(`/webhooks/${hook.id}`, 'delete', '/webhooks/{webhook_id}'); }
});

test('real API key resource responses conform to OpenAPI', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const key = await contract('/api-keys', 'post', '/api-keys', 201, { name: 'OpenAPI contract', permission: 'sending_access', sending_domain: 'example.com' });
  try {
    await contract('/api-keys', 'get', '/api-keys');
    await contract(`/api-keys/${key.id}`, 'patch', '/api-keys/{key_id}', 200, { name: 'Renamed' });
  } finally { await contract(`/api-keys/${key.id}`, 'delete', '/api-keys/{key_id}', 204); }
});


test('locally received MIME, envelope metadata and attachments conform to OpenAPI', { skip: process.env.TEST_INBOUND !== 'true' }, async () => {
  const marker = await injectReceivedFixture(base);
  const list = await contract(`/emails/receiving?subject=${encodeURIComponent(marker)}`, 'get', '/emails/receiving');
  assert.equal(list.data.length, 1);
  const id = list.data[0].id;
  try {
    const detail = await contract(`/emails/receiving/${id}`, 'get', '/emails/receiving/{email_id}');
    assert.equal(detail.from, 'bounce@example.net'); assert.equal(detail.to, 'inbox@example.com');
    assert.equal(detail.header_from.address, 'customer@example.com');
    await contract(`/emails/receiving/${id}/attachments`, 'get', '/emails/receiving/{email_id}/attachments');
    const file = await fetch(`${base}/emails/receiving/${id}/attachments/0`, { headers });
    assert.equal(file.status, 200); assert.match(file.headers.get('content-type'), /application\/octet-stream/); assert.match(file.headers.get('content-disposition'), /^attachment/); assert.equal(await file.text(), 'hi');
  } finally { await contract(`/emails/receiving/${id}`, 'delete', '/emails/receiving/{email_id}'); }
});
