import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Resend } from 'resend';
import { localTestOrigin } from './local-auth-mail.mjs';
const source = JSON.parse(await readFile(new URL('../public/openapi-v1.json', import.meta.url), 'utf8'));
const spec = await SwaggerParser.validate(structuredClone(source), { resolve: { external: false, file: false, http: false } });
const ajv = new Ajv({ strict: false }); addFormats(ajv);
const base = localTestOrigin(process.env.TEST_BASE_URL || 'http://127.0.0.1:8787');

test('versioned OpenAPI is public, self-contained and describes JSON attachment metadata', async () => {
  assert.deepEqual(source.servers.map(server => server.url), ['/v1']);
  assert.equal(Object.keys(source.paths).length, 31);
  assert.equal(source.paths['/api/auth/sign-in/email'], undefined); assert.equal(source.paths['/downloads/receiving/{email_id}/raw'], undefined);
  const response = await fetch(`${base}/v1/openapi.json`); assert.equal(response.status, 200); assert.deepEqual(await response.json(), source);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(`${base}/v1/openapi.json`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${base}/v1/openapi.json`, { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(`${base}/v1/openapi.json`, { method: 'POST' })).status, 405);
  for (const path of ['/emails/{email_id}/attachments/{attachment_id}', '/emails/receiving/{email_id}/attachments/{attachment_id}']) {
    assert.ok(source.paths[path].get.responses['200'].content['application/json']);
    assert.equal(source.paths[path].get.responses['200'].content['application/octet-stream'], undefined);
  }
});

test('real official SDK attachment and denied responses conform to the versioned contract', async () => {
  const client = new Resend(process.env.TEST_API_KEY || 'local-test-key', { baseUrl: `${base}/v1` });
  const sent = await client.emails.send({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'Synthetic SDK contract', text: 'Hi', attachments: [{ filename: 'test.txt', content: 'aGk=' }] });
  assert.equal(sent.error === null, true);
  const list = await client.emails.attachments.list({ emailId: sent.data.id }); assert.equal(list.error === null, true);
  const item = await client.emails.attachments.get({ emailId: sent.data.id, id: list.data.data[0].id }); assert.equal(item.error === null, true);
  for (const [path, data] of [['/emails/{email_id}/attachments', list.data], ['/emails/{email_id}/attachments/{attachment_id}', item.data]]) {
    const validate = ajv.compile(spec.paths[path].get.responses['200'].content['application/json'].schema);
    assert.equal(validate(data), true, JSON.stringify(validate.errors));
  }
  const denied = await new Resend('wrong-local-key', { baseUrl: `${base}/v1` }).emails.attachments.list({ emailId: sent.data.id });
  const validate = ajv.compile(spec.components.schemas.Error); assert.equal(validate(denied.error), true);
});
