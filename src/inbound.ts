import PostalMime from 'postal-mime';
import { attachmentForAgent } from './agent-attachment.ts';
import { attachmentList } from './attachment-list.ts';

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
  await env.DB.prepare('INSERT INTO inbound_emails (id, sender, recipient, subject, created_at, object_key, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, message.from, message.to, (message.headers.get('subject') ?? '').slice(0, 998), new Date().toISOString(), objectKey, message.headers.get('message-id')?.slice(0, 998) ?? null).run();
}

export async function readReceived(request: Request, env: InboundEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/emails/receiving') {
    const params = url.searchParams;
    const raw = params.get('limit') ?? '20';
    const allowedParams = ['limit', 'before', 'after', 'from', 'to', 'subject'];
    if ([...params.keys()].some(key => !allowedParams.includes(key)) || allowedParams.some(key => params.getAll(key).length > 1) || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return response({ message: 'Invalid pagination or filter' }, 400);
    const before = params.get('before'); const after = params.get('after');
    if ((before !== null && after !== null) || before === '' || after === '') return response({ message: 'Invalid cursor' }, 400);
    const cursor = before ?? after; const conditions: string[] = []; const values: string[] = [];
    for (const [param, column] of [['from', 'sender'], ['to', 'recipient'], ['subject', 'subject']]) {
      const value = params.get(param);
      if (value !== null) {
        if (!value.trim() || value.length > 256) return response({ message: 'Invalid filter' }, 400);
        conditions.push(`instr(lower(${column}), lower(?)) > 0`); values.push(value.trim());
      }
    }
    if (cursor !== null) {
      const anchor = await env.DB.prepare('SELECT id, created_at FROM inbound_emails WHERE id = ?').bind(cursor).first<{ id: string; created_at: string }>();
      if (!anchor) return response({ message: 'Invalid cursor' }, 400);
      conditions.push(before !== null ? '(created_at, id) > (?, ?)' : '(created_at, id) < (?, ?)');
      values.push(anchor.created_at, anchor.id);
    }
    const direction = before !== null ? 'ASC' : 'DESC'; const limit = Number(raw);
    const condition = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await env.DB.prepare(`SELECT id, sender, recipient, subject, created_at, message_id FROM inbound_emails ${condition} ORDER BY created_at ${direction}, id ${direction} LIMIT ?`).bind(...values, limit + 1).all<{ id: string; sender: string; recipient: string; subject: string; created_at: string; message_id: string | null }>();
    const result = rows.results.slice(0, limit); if (before !== null) result.reverse();
    return response({ object: 'list', data: result.map(row => ({ ...row, from: row.sender, to: [row.recipient] })), has_more: rows.results.length > limit });
  }
  const match = url.pathname.match(/^\/emails\/receiving\/([0-9a-f-]{36})(?:\/(attachments)(?:\/(\d+))?)?$/);
  if (!match) return response({ message: 'Not found' }, 404);
  const row = await env.DB.prepare('SELECT * FROM inbound_emails WHERE id = ?').bind(match[1]).first<InboundRow>();
  if (!row) return response({ message: 'Not found' }, 404);
  const object = await env.INBOUND.get(row.object_key);
  if (!object) return response({ message: 'Email content is unavailable' }, 503);
  const parsed = await PostalMime.parse(await object.arrayBuffer());
  const bytes = (value: string | ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> => typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
  if (match[3] !== undefined) {
    const attachment = parsed.attachments[Number(match[3])];
    if (!attachment) return response({ message: 'Not found' }, 404);
    const filename = attachment.filename ? encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(attachment.filename))).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`) : null;
    const content = bytes(attachment.content);
    return new Response(content, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(content.byteLength), 'content-disposition': filename ? `attachment; filename*=UTF-8''${filename}` : 'attachment', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
  }
  const attachments = parsed.attachments.map((attachment, index) => ({ id: String(index), filename: attachment.filename, content_type: attachment.mimeType, content_id: attachment.contentId ?? null, content_disposition: attachment.disposition, size: bytes(attachment.content).byteLength }));
  if (match[2]) return attachmentList(attachments, url.searchParams);
  return response({ id: row.id, from: row.sender, to: row.recipient, header_from: parsed.from ?? null, header_to: parsed.to ?? [], cc: parsed.cc ?? [], bcc: parsed.bcc ?? [], reply_to: parsed.replyTo ?? [], subject: parsed.subject ?? row.subject, created_at: row.created_at, text: parsed.text ?? null, html: parsed.html ?? null, message_id: parsed.messageId ?? null, in_reply_to: parsed.inReplyTo ?? null, references: parsed.references ?? null, attachments });
}

export async function readReceivedAttachmentForAgent(id: string, index: number, env: InboundEnv) {
  return attachmentForAgent(await readReceived(new Request(`https://cloudmail.invalid/emails/receiving/${id}/attachments/${index}`), env));
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
