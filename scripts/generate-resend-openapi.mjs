import { readFileSync, writeFileSync } from 'node:fs';

// The legacy contract remains canonical; only representation differences are maintained here.
const doc = JSON.parse(readFileSync(new URL('../public/openapi.json', import.meta.url), 'utf8'));
doc.info.title = 'Cloudmail SDK API';
doc.info.description = 'Cloudmail /v1 REST adapter. Attachment get/list use stable UUIDs and one-hour signed download URLs; existing operations otherwise retain current Cloudmail limits. This is not complete Resend compatibility. Dashboard sessions, MCP, public assets and capability downloads are not aliases. Actual download URLs point to the installation root and are described in /openapi.json.';
doc.servers = [{ url: '/v1', description: 'The installation REST compatibility adapter' }];
doc.paths = Object.fromEntries(Object.entries(doc.paths).filter(([path]) => /^\/(emails|templates|domains|api-keys|webhooks)(\/|$)/.test(path)));
const schemas = doc.components.schemas;
schemas.Attachment.properties.id = { type: 'string', format: 'uuid', description: 'Opaque stable attachment UUID. Use it only with the parent message and direction that returned it.' };
schemas.Attachment.description = 'Attachment metadata in /v1. UUID identities differ from legacy zero-based indexes; no stored content is rewritten.';
schemas.DownloadableAttachment = { allOf: [{ $ref: '#/components/schemas/Attachment' }, { type: 'object', properties: { download_url: { type: 'string', format: 'uri', description: 'Temporary bearer capability for this attachment. GET/HEAD require no cookies or API key. Keep private.' }, expires_at: { type: 'string', format: 'date-time' } }, required: ['download_url', 'expires_at'] }] };
schemas.ReceivedDetail.properties.to = { type: 'array', items: { type: 'string' }, description: 'SMTP envelope recipient addresses; header_to is separate untrusted message metadata.' };
schemas.ReceivedDetail.properties.object = { const: 'email' }; schemas.ReceivedDetail.required.push('object');
schemas.Error.properties.statusCode = { type: 'integer' }; schemas.Error.required.push('name', 'statusCode');
for (const prefix of ['/emails/{email_id}', '/emails/receiving/{email_id}']) {
  const list = doc.paths[`${prefix}/attachments`].get;
  list.description = 'List private metadata and one-hour signed download URLs. Cursors are returned UUIDs within this message/direction, never legacy indexes; duplicate or conflicting cursors are rejected. Older messages without retained metadata can return 404. Signing configuration is required when links are returned.';
  list.responses['200'].content['application/json'].schema.properties.data.items.$ref = '#/components/schemas/DownloadableAttachment';
  for (const param of list.parameters) if (['after', 'before'].includes(param.name)) param.schema = { type: 'string', format: 'uuid' };
  const old = `${prefix}/attachments/{attachment_index}`; const item = doc.paths[old]; delete doc.paths[old];
  doc.paths[`${prefix}/attachments/{attachment_id}`] = item;
  const get = item.get;
  get.operationId = prefix.includes('receiving') ? 'getReceivedAttachment' : 'getSentAttachment';
  get.summary = 'Retrieve private attachment metadata';
  get.description = 'Return attachment metadata with a one-hour signed download URL. Requires a full-access API key and configured installation signing secret/origin. The URL itself is a bearer capability. No query parameters are accepted.';
  get.responses['200'] = { description: 'Attachment metadata and an expiring private download URL.', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/DownloadableAttachment' }, { type: 'object', properties: { object: { const: 'attachment' } }, required: ['object'] }] } } } };
  for (const param of get.parameters) if (param.name === 'attachment_index') { param.name = 'attachment_id'; param.schema = { type: 'string', format: 'uuid' }; }
}
const deletion = doc.paths['/api-keys/{key_id}'].delete;
delete deletion.responses['204'];
deletion.responses['200'] = { description: 'Key revoked.', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } } } };
const output = `${JSON.stringify(doc, null, 2)}\n`;
const file = new URL('../public/openapi-v1.json', import.meta.url);
if (process.argv.includes('--write')) writeFileSync(file, output);
else if (readFileSync(file, 'utf8') !== output) throw new Error('The /v1 OpenAPI contract is stale. Run node scripts/generate-resend-openapi.mjs --write.');
