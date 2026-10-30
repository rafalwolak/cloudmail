import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveEmail, readReceived, readReceivedAttachmentForAgent, deleteReceived } from '../src/inbound.ts';
const raw = 'From: sender@example.com\r\nTo: inbox@example.com\r\nSubject: Hello\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello inbox';
function fixture() {
  const objects = new Map(); const rows = new Map();
  const env = { INBOUND_ENABLED: 'true', INBOUND_ADDRESSES: 'inbox@example.com', INBOUND: { async put(key, stream) { objects.set(key, await new Response(stream).arrayBuffer()); }, async get(key) { const value = objects.get(key); return value ? { arrayBuffer: async () => value } : null; }, async delete(key) { objects.delete(key); } }, DB: { prepare(sql) { return { bind(...args) { return { async run() { if (sql.startsWith('DELETE')) { rows.delete(args[0]); return { meta: { changes: 1 } }; } rows.set(args[0], { id: args[0], sender: args[1], recipient: args[2], subject: args[3], created_at: args[4], object_key: args[5], message_id: args[6] }); }, async first() { return rows.get(args[0]) || null; } }; } }; } } };
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
test('stores a bounded message ID header for webhook metadata', async () => {
  const context = fixture(); context.message.headers.set('message-id', '<thread@example.com>');
  await receiveEmail(context.message, context.env);
  assert.equal([...context.rows.values()][0].message_id, '<thread@example.com>');
});
test('rejects disabled, unconfigured and oversized inbound messages', async () => {
  for (const change of [({ env }) => { env.INBOUND_ENABLED = 'false'; }, ({ message }) => { message.to = 'unknown@example.com'; }, ({ message }) => { message.rawSize = 26 * 1024 * 1024; }]) {
    const context = fixture(); change(context); await receiveEmail(context.message, context.env);
    assert.ok(context.message.rejected); assert.equal(context.rows.size, 0); assert.equal(context.objects.size, 0);
  }
});


test('plus addressing is opt-in and preserves the original envelope recipient', async () => {
  for (const [address, enabled, accepted] of [
    ['Inbox+orders@Example.com', false, false],
    ['Inbox+orders@Example.com', true, true],
    ['inbox+@example.com', true, false],
    ['inbox+orders@other.example.com', true, false],
    ['other+orders@example.com', true, false],
    ['inbox+orders@example.com@other.example.com', true, false],
  ]) {
    const context = fixture(); context.message.to = address;
    context.env.INBOUND_ALLOW_PLUS_ADDRESSES = String(enabled);
    await receiveEmail(context.message, context.env);
    assert.equal(!context.message.rejected, accepted, address);
    assert.equal(context.rows.size, Number(accepted));
    if (accepted) assert.equal([...context.rows.values()][0].recipient, address);
  }
});
test('exposes message headers separately from SMTP envelope addresses', async () => {
  const context = fixture();
  const mime = 'From: Alice <alice@example.com>\r\nTo: Team: Bob <bob@example.com>, carol@example.com;\r\nCc: cc@example.com\r\nReply-To: Reply <reply@example.com>\r\nMessage-ID: <message@example.com>\r\nIn-Reply-To: <previous@example.com>\r\nReferences: <first@example.com> <previous@example.com>\r\n\r\nHello';
  context.message.raw = new Blob([mime]).stream(); context.message.rawSize = mime.length;
  await receiveEmail(context.message, context.env);
  const id = [...context.rows.keys()][0];
  const detail = await (await readReceived(new Request(`https://example.com/emails/receiving/${id}`), context.env)).json();
  assert.equal(detail.from, 'sender@example.com'); assert.equal(detail.to, 'inbox@example.com');
  assert.equal(detail.header_from.address, 'alice@example.com');
  assert.deepEqual(detail.header_to[0].group.map(item => item.address), ['bob@example.com', 'carol@example.com']);
  assert.equal(detail.cc[0].address, 'cc@example.com'); assert.equal(detail.reply_to[0].address, 'reply@example.com');
  assert.equal(detail.in_reply_to, '<previous@example.com>'); assert.match(detail.references, /first@example.com/);
});
test('preserves uploaded MIME object when a D1 response is uncertain', async () => {
  const context = fixture(); context.env.DB.prepare = () => ({ bind: () => ({ run: async () => { throw new Error('D1 unavailable'); } }) });
  await assert.rejects(() => receiveEmail(context.message, context.env));
  assert.equal(context.objects.size, 1);
});


test('retains content when D1 committed before reporting a failure', async () => {
  const context = fixture(); const prepare = context.env.DB.prepare;
  context.env.DB.prepare = sql => ({ bind: (...args) => ({ async run() { await prepare(sql).bind(...args).run(); throw new Error('response lost'); } }) });
  await assert.rejects(() => receiveEmail(context.message, context.env));
  assert.equal(context.rows.size, 1);
  assert.ok(context.objects.has([...context.rows.values()][0].object_key));
});

test('returns attachments as downloads with safe response headers', async () => {
  const context = fixture();
  const mime = 'From: sender@example.com\r\nTo: inbox@example.com\r\nSubject: Attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: text/plain\r\n\r\nHello\r\n--test\r\nContent-Type: text/html; name="unsafe.html"\r\nContent-Disposition: attachment; filename="unsafe.html"\r\n\r\n<script>alert(1)</script>\r\n--test--\r\n';
  context.message.raw = new Blob([mime]).stream(); context.message.rawSize = mime.length;
  await receiveEmail(context.message, context.env);
  const id = [...context.rows.keys()][0];
  const detail = await (await readReceived(new Request(`https://example.com/emails/receiving/${id}`), context.env)).json();
  assert.equal(detail.attachments[0].filename, 'unsafe.html');
  assert.equal(detail.attachments[0].content_disposition, 'attachment');
  assert.equal(detail.attachments[0].content_id, null);
  const list = await readReceived(new Request(`https://example.com/emails/receiving/${id}/attachments?limit=1`), context.env);
  assert.equal(list.status, 200); assert.deepEqual((await list.json()).data, detail.attachments);
  assert.equal((await readReceived(new Request(`https://example.com/emails/receiving/${id}/attachments?after=bad`), context.env)).status, 400);
  const attachment = await readReceived(new Request(`https://example.com/emails/receiving/${id}/attachments/0`), context.env);
  assert.equal(attachment.headers.get('content-type'), 'application/octet-stream');
  assert.equal(attachment.headers.get('content-disposition'), "attachment; filename*=UTF-8''unsafe.html");
  assert.match(await attachment.text(), /<script>/);
  const agent = await readReceivedAttachmentForAgent(id, 0, context.env);
  assert.equal(agent.isError, undefined);
  assert.match(atob(JSON.parse(agent.content[0].text).content_base64), /<script>/);
  assert.equal((await readReceivedAttachmentForAgent(id, 1, context.env)).isError, true);
});

test('reports inline attachment content ID and disposition', async () => {
  const context = fixture();
  const mime = 'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="test"\r\n\r\n--test\r\nContent-Type: text/html\r\n\r\n<img src="cid:logo@example.com">\r\n--test\r\nContent-Type: image/png\r\nContent-Disposition: inline; filename="logo.png"\r\nContent-ID: <logo@example.com>\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--test--\r\n';
  context.message.raw = new Blob([mime]).stream(); context.message.rawSize = mime.length;
  await receiveEmail(context.message, context.env);
  const id = [...context.rows.keys()][0];
  const detail = await (await readReceived(new Request(`https://example.com/emails/receiving/${id}`), context.env)).json();
  assert.equal(detail.attachments[0].content_disposition, 'inline');
  assert.match(detail.attachments[0].content_id, /logo@example\.com/);
});

test('agent attachment response rejects files above its size limit', async () => {
  const context = fixture();
  const mime = `MIME-Version: 1.0\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="large.bin"\r\n\r\n${'a'.repeat(1024 * 1024 + 1)}`;
  context.message.raw = new Blob([mime]).stream(); context.message.rawSize = mime.length;
  await receiveEmail(context.message, context.env);
  const result = await readReceivedAttachmentForAgent([...context.rows.keys()][0], 0, context.env);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /size limit/);
});

test('encodes untrusted Unicode attachment filenames in download headers', async () => {
  const context = fixture();
  const mime = 'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename*=UTF-8\'\'raport%20%C5%BC%C3%B3%C5%82w%3B%22.txt\r\n\r\ncontent\r\n--test--\r\n';
  context.message.raw = new Blob([mime]).stream(); context.message.rawSize = mime.length;
  await receiveEmail(context.message, context.env);
  const id = [...context.rows.keys()][0];
  const attachment = await readReceived(new Request(`https://example.com/emails/receiving/${id}/attachments/0`), context.env);
  assert.equal(attachment.headers.get('content-disposition'), "attachment; filename*=UTF-8''raport%20%C5%BC%C3%B3%C5%82w%3B%22.txt");
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
