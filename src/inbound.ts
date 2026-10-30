import PostalMime from 'postal-mime';

export interface InboundEnv { DB: D1Database; INBOUND: R2Bucket; INBOUND_ENABLED?: string; INBOUND_ADDRESSES?: string }
interface InboundRow { id: string; sender: string; recipient: string; subject: string; created_at: string; object_key: string }
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

export async function receiveEmail(message: ForwardableEmailMessage, env: InboundEnv): Promise<void> {
  const allowed = (env.INBOUND_ADDRESSES ?? '').split(',').map(address => address.trim().toLowerCase()).filter(Boolean);
  if (env.INBOUND_ENABLED !== 'true' || !allowed.includes(message.to.toLowerCase())) { message.setReject('Recipient is not configured'); return; }
  if (message.rawSize > 25 * 1024 * 1024) { message.setReject('Message exceeds size limit'); return; }
  const id = crypto.randomUUID(); const objectKey = `inbound/${id}`;
  await env.INBOUND.put(objectKey, message.raw);
  // A failed D1 response can follow a successful commit. Keep the object so a
  // committed metadata row never points to content deleted on an uncertain result.
  await env.DB.prepare('INSERT INTO inbound_emails (id, sender, recipient, subject, created_at, object_key) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, message.from, message.to, (message.headers.get('subject') ?? '').slice(0, 998), new Date().toISOString(), objectKey).run();
}

export async function readReceived(request: Request, env: InboundEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/emails/receiving') {
    const params = url.searchParams;
    const raw = params.get('limit') ?? '20';
    if ([...params.keys()].some(key => !['limit', 'before', 'after'].includes(key)) || ['limit', 'before', 'after'].some(key => params.getAll(key).length > 1) || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return response({ message: 'Invalid pagination' }, 400);
    const before = params.get('before'); const after = params.get('after');
    if ((before !== null && after !== null) || before === '' || after === '') return response({ message: 'Invalid cursor' }, 400);
    const cursor = before ?? after; let condition = ''; let values: string[] = [];
    if (cursor !== null) {
      const anchor = await env.DB.prepare('SELECT id, created_at FROM inbound_emails WHERE id = ?').bind(cursor).first<{ id: string; created_at: string }>();
      if (!anchor) return response({ message: 'Invalid cursor' }, 400);
      condition = before !== null ? 'WHERE (created_at, id) > (?, ?)' : 'WHERE (created_at, id) < (?, ?)';
      values = [anchor.created_at, anchor.id];
    }
    const direction = before !== null ? 'ASC' : 'DESC'; const limit = Number(raw);
    const rows = await env.DB.prepare(`SELECT id, sender, recipient, subject, created_at FROM inbound_emails ${condition} ORDER BY created_at ${direction}, id ${direction} LIMIT ?`).bind(...values, limit + 1).all();
    const result = rows.results.slice(0, limit); if (before !== null) result.reverse();
    return response({ object: 'list', data: result, has_more: rows.results.length > limit });
  }
  const match = url.pathname.match(/^\/emails\/receiving\/([0-9a-f-]{36})(?:\/attachments\/(\d+))?$/);
  if (!match) return response({ message: 'Not found' }, 404);
  const row = await env.DB.prepare('SELECT * FROM inbound_emails WHERE id = ?').bind(match[1]).first<InboundRow>();
  if (!row) return response({ message: 'Not found' }, 404);
  const object = await env.INBOUND.get(row.object_key);
  if (!object) return response({ message: 'Email content is unavailable' }, 503);
  const parsed = await PostalMime.parse(await object.arrayBuffer());
  const bytes = (value: string | ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> => typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
  if (match[2] !== undefined) {
    const attachment = parsed.attachments[Number(match[2])];
    if (!attachment) return response({ message: 'Not found' }, 404);
    const filename = attachment.filename ? encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(attachment.filename))).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`) : null;
    const content = bytes(attachment.content);
    return new Response(content, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(content.byteLength), 'content-disposition': filename ? `attachment; filename*=UTF-8''${filename}` : 'attachment', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
  }
  return response({ id: row.id, from: row.sender, to: row.recipient, header_from: parsed.from ?? null, header_to: parsed.to ?? [], cc: parsed.cc ?? [], bcc: parsed.bcc ?? [], reply_to: parsed.replyTo ?? [], subject: parsed.subject ?? row.subject, created_at: row.created_at, text: parsed.text ?? null, html: parsed.html ?? null, message_id: parsed.messageId ?? null, in_reply_to: parsed.inReplyTo ?? null, references: parsed.references ?? null, attachments: parsed.attachments.map((attachment, index) => ({ id: String(index), filename: attachment.filename, content_type: attachment.mimeType, size: bytes(attachment.content).byteLength })) });
}

export async function readReceivedAttachmentForAgent(id: string, index: number, env: InboundEnv) {
  const result = await readReceived(new Request(`https://cloudmail.invalid/emails/receiving/${id}/attachments/${index}`), env);
  if (!result.ok) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(await result.json()) }] };
  if (Number(result.headers.get('content-length')) > 1024 * 1024) return { isError: true, content: [{ type: 'text' as const, text: 'Attachment exceeds the 1 MiB MCP size limit; download it through the authenticated API.' }] };
  const data = new Uint8Array(await result.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return { content: [{ type: 'text' as const, text: JSON.stringify({ content_base64: btoa(binary), size: data.length }) }] };
}

export async function deleteReceived(id: string, env: InboundEnv): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return response({ message: 'Not found' }, 404);
  const row = await env.DB.prepare('SELECT object_key FROM inbound_emails WHERE id = ?').bind(id).first<{ object_key: string }>();
  if (!row) return response({ message: 'Not found' }, 404);
  // Delete content first so a storage failure leaves a record that can be retried.
  await env.INBOUND.delete(row.object_key);
  await env.DB.prepare('DELETE FROM inbound_emails WHERE id = ?').bind(id).run();
  return response({ id, deleted: true });
}
