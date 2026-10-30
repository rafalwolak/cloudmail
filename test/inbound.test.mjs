import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveEmail, readReceived, deleteReceived } from '../src/inbound.ts';
const raw = 'From: sender@example.com\r\nTo: inbox@example.com\r\nSubject: Hello\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello inbox';
function fixture() {
  const objects = new Map(); const rows = new Map();
  const env = { INBOUND_ENABLED: 'true', INBOUND_ADDRESSES: 'inbox@example.com', INBOUND: { async put(key, stream) { objects.set(key, await new Response(stream).arrayBuffer()); }, async get(key) { const value = objects.get(key); return value ? { arrayBuffer: async () => value } : null; }, async delete(key) { objects.delete(key); } }, DB: { prepare(sql) { return { bind(...args) { return { async run() { if (sql.startsWith('DELETE')) { rows.delete(args[0]); return { meta: { changes: 1 } }; } rows.set(args[0], { id: args[0], sender: args[1], recipient: args[2], subject: args[3], created_at: args[4], object_key: args[5] }); }, async first() { return rows.get(args[0]) || null; } }; } }; } } };
  const message = { from: 'sender@example.com', to: 'inbox@example.com', headers: new Headers({ subject: 'Hello' }), rawSize: new TextEncoder().encode(raw).length, raw: new Blob([raw]).stream(), setReject(reason) { this.rejected = reason; } };
  return { env, message, rows, objects };
}
test('accepts configured recipients and returns parsed untrusted content', async () => {
  const { env, message, rows } = fixture();
  await receiveEmail(message, env);
  assert.equal(message.rejected, undefined); assert.equal(rows.size, 1);
  const id = [...rows.keys()][0];
  const response = await readReceived(new Request(`https://example.com/emails/receiving/${id}`), env);
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.subject, 'Hello'); assert.equal(data.text, 'Hello inbox\n');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('rejects disabled, unconfigured and oversized inbound messages', async () => {
  for (const change of [({ env }) => { env.INBOUND_ENABLED = 'false'; }, ({ message }) => { message.to = 'unknown@example.com'; }, ({ message }) => { message.rawSize = 26 * 1024 * 1024; }]) {
    const context = fixture(); change(context); await receiveEmail(context.message, context.env);
    assert.ok(context.message.rejected); assert.equal(context.rows.size, 0); assert.equal(context.objects.size, 0);
  }
});
test('removes uploaded MIME object if metadata cannot be committed', async () => {
  const context = fixture(); context.env.DB.prepare = () => ({ bind: () => ({ run: async () => { throw new Error('D1 unavailable'); } }) });
  await assert.rejects(() => receiveEmail(context.message, context.env));
  assert.equal(context.objects.size, 0);
});


test('returns attachments as downloads with safe response headers', async () => {
  const context = fixture();
  const mime = 'From: sender@example.com\r\nTo: inbox@example.com\r\nSubject: Attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: text/plain\r\n\r\nHello\r\n--test\r\nContent-Type: text/html; name="unsafe.html"\r\nContent-Disposition: attachment; filename="unsafe.html"\r\n\r\n<script>alert(1)</script>\r\n--test--\r\n';
  context.message.raw = new Blob([mime]).stream(); context.message.rawSize = mime.length;
  await receiveEmail(context.message, context.env);
  const id = [...context.rows.keys()][0];
  const detail = await (await readReceived(new Request(`https://example.com/emails/receiving/${id}`), context.env)).json();
  assert.equal(detail.attachments[0].filename, 'unsafe.html');
  const attachment = await readReceived(new Request(`https://example.com/emails/receiving/${id}/attachments/0`), context.env);
  assert.equal(attachment.headers.get('content-type'), 'application/octet-stream');
  assert.equal(attachment.headers.get('content-disposition'), 'attachment');
  assert.match(await attachment.text(), /<script>/);
});


test('deletes both stored message and metadata, and preserves metadata if R2 fails', async () => {
  const context = fixture(); await receiveEmail(context.message, context.env);
  const id = [...context.rows.keys()][0];
  const originalDelete = context.env.INBOUND.delete;
  context.env.INBOUND.delete = async () => { throw new Error('R2 unavailable'); };
  await assert.rejects(() => deleteReceived(id, context.env));
  assert.equal(context.rows.size, 1); assert.equal(context.objects.size, 1);
  context.env.INBOUND.delete = originalDelete;
  const deleted = await deleteReceived(id, context.env);
  assert.equal(deleted.status, 200); assert.equal(context.rows.size, 0); assert.equal(context.objects.size, 0);
  assert.equal((await deleteReceived(id, context.env)).status, 404);
});
