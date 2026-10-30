import { parseStoredAttachments, readSentContent, storeSentContent } from './sent-content';
import type { AuthEnv } from './auth';
import type { OutboundEmail } from './email';
import { withPlainText } from './plain-text';
import { attachmentList } from './attachment-list';

export class IdempotencyConflict extends Error {
  constructor(public code: string) { super(code); }
}

export async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function serializeRecipients(value: string | string[] | undefined): string {
  return JSON.stringify(value === undefined ? [] : Array.isArray(value) ? value : [value]);
}

async function readScheduledContent(env: AuthEnv & { INBOUND: R2Bucket }, id: string) {
  const row = await env.DB.prepare("SELECT payload, payload_r2_key FROM scheduled_emails WHERE id = ? AND state = 'scheduled'").bind(id).first<{ payload: string | null; payload_r2_key: string | null }>();
  if (!row) return null;
  const payload = row.payload_r2_key ? await (await env.INBOUND.get(row.payload_r2_key))?.text() : row.payload;
  if (!payload) throw new Error('Missing scheduled payload');
  const message: unknown = JSON.parse(payload);
  if (!message || typeof message !== 'object') throw new Error('Invalid scheduled payload');
  const value = message as Record<string, unknown>;
  return { html: typeof value.html === 'string' ? value.html : null, text: typeof value.text === 'string' ? value.text : null, attachments: parseStoredAttachments(value.attachments) ?? [] };
}

function attachmentMetadata(items: NonNullable<ReturnType<typeof parseStoredAttachments>>) {
  return items.map((item, index) => ({ id: String(index), filename: item.filename, content_type: item.type, content_id: item.contentId ?? null, content_disposition: item.disposition, size: item.content.length / 4 * 3 - (item.content.endsWith('==') ? 2 : item.content.endsWith('=') ? 1 : 0) }));
}

export async function sendRecordedEmail(env: AuthEnv, email: OutboundEmail, idempotencyKey?: string, retainContent = true): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const to = Array.isArray(email.to) ? email.to : [email.to];
  const keyHash = idempotencyKey ? await digest(idempotencyKey) : null;
  const requestHash = keyHash ? await digest(JSON.stringify(email)) : null;
  const prepared = withPlainText(email);
  if (keyHash) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE email_history SET idempotency_key_hash = NULL WHERE idempotency_key_hash = ? AND created_at < ?').bind(keyHash, cutoff).run();
  }
  const insert = await env.DB.prepare('INSERT INTO email_history (id, sender, recipients, subject, status, created_at, idempotency_key_hash, request_hash, tags, cc, bcc, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key_hash) DO NOTHING')
    .bind(id, email.from, JSON.stringify(to), email.subject, 'pending', new Date().toISOString(), keyHash, requestHash, JSON.stringify(email.tags ?? []), serializeRecipients(email.cc), serializeRecipients(email.bcc), email.replyTo ?? null).run();
  if (!insert.meta.changes) {
    const existing = await env.DB.prepare('SELECT id, request_hash, status FROM email_history WHERE idempotency_key_hash = ?').bind(keyHash).first<{ id: string; request_hash: string; status: string }>();
    if (!existing || existing.request_hash !== requestHash) throw new IdempotencyConflict('invalid_idempotent_request');
    if (existing.status !== 'accepted') throw new IdempotencyConflict('concurrent_or_uncertain_idempotent_request');
    return { id: existing.id };
  }
  if (retainContent) {
    try {
      await storeSentContent(env.INBOUND, id, prepared);
      await env.DB.prepare('UPDATE email_history SET body_stored = 1 WHERE id = ?').bind(id).run();
    } catch (error) {
      // No delivery was attempted. Only remove the object after D1 confirms the row is gone.
      try {
        const removed = await env.DB.prepare("DELETE FROM email_history WHERE id = ? AND status = 'pending'").bind(id).run();
        if (removed.meta.changes) await env.INBOUND.delete(`sent/${id}`);
      } catch { console.error('Could not clean up unsent email content'); }
      throw error;
    }
  }
  let result: { messageId: string };
  try {
    const { tags: _tags, ...message } = prepared;
    result = await env.EMAIL.send(message);
  } catch (error) {
    try { await env.DB.prepare("UPDATE email_history SET status = 'unknown' WHERE id = ?").bind(id).run(); }
    catch { console.error('Could not update email history after send error'); }
    throw error;
  }
  try { await env.DB.prepare("UPDATE email_history SET status = 'accepted', provider_id = ? WHERE id = ?").bind(result.messageId, id).run(); }
  catch { console.error('Could not update email history after acceptance'); }
  return { id };
}

interface HistoryRow { id: string; sender: string; recipients: string; subject: string; status: string; created_at: string; tags: string; cc: string | null; bcc: string | null; reply_to: string | null; schedule_state: string | null; scheduled_at: string | null; last_event: string | null; prepare_attempts: number | null; prepare_after: string | null }
function format(row: HistoryRow) {
  return { id: row.id, from: row.sender, to: JSON.parse(row.recipients), subject: row.subject, status: row.schedule_state ?? row.status, scheduled_at: row.scheduled_at, created_at: row.created_at, tags: JSON.parse(row.tags), cc: row.cc === null ? null : JSON.parse(row.cc), bcc: row.bcc === null ? null : JSON.parse(row.bcc), reply_to: row.reply_to, last_event: row.last_event, preparation_attempts: row.schedule_state === 'scheduled' ? row.prepare_attempts : null, preparation_retry_at: row.schedule_state === 'scheduled' ? row.prepare_after : null };
}

export async function readHistory(request: Request, env: AuthEnv & { INBOUND: R2Bucket }): Promise<Response> {
  const url = new URL(request.url);
  const fields = "email_history.id, sender, recipients, subject, status, created_at, tags, cc, bcc, reply_to, scheduled_emails.state AS schedule_state, scheduled_at, prepare_attempts, prepare_after, (SELECT type FROM delivery_events WHERE provider_id = email_history.provider_id ORDER BY occurred_at DESC, id DESC LIMIT 1) AS last_event";
  const tables = 'email_history LEFT JOIN scheduled_emails ON scheduled_emails.id = email_history.id';
  if (url.pathname === '/emails') {
    const params = url.searchParams;
    const allowed = ['limit', 'before', 'after', 'from', 'to', 'subject', 'status', 'last_event'];
    if ([...params.keys()].some(key => !allowed.includes(key)) || allowed.some(key => params.getAll(key).length > 1)) return Response.json({ message: 'Unsupported or duplicate query parameter' }, { status: 400 });
    const raw = params.get('limit') ?? '20';
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return Response.json({ message: 'limit must be between 1 and 100' }, { status: 400 });
    const before = params.get('before');
    const after = params.get('after');
    if ((before !== null && after !== null) || before === '' || after === '') return Response.json({ message: 'Provide only one valid cursor' }, { status: 400 });
    const cursor = before ?? after;
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    for (const key of ['from', 'to', 'subject']) {
      const value = params.get(key);
      if (value === null) continue;
      if (!value.trim() || value.length > 256) return Response.json({ message: 'Invalid filter' }, { status: 400 });
      conditions.push(key === 'to' ? 'EXISTS (SELECT 1 FROM json_each(email_history.recipients) WHERE instr(lower(value), lower(?)) > 0)' : `instr(lower(${key === 'from' ? 'sender' : 'subject'}), lower(?)) > 0`);
      values.push(value.trim());
    }
    const status = params.get('status');
    if (status !== null) {
      if (!['pending', 'accepted', 'unknown', 'scheduled', 'sending', 'canceled'].includes(status)) return Response.json({ message: 'Invalid status filter' }, { status: 400 });
      conditions.push('COALESCE(scheduled_emails.state, email_history.status) = ?'); values.push(status);
    }
    const lastEvent = params.get('last_event');
    if (lastEvent !== null) {
      if (!['delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'].includes(lastEvent)) return Response.json({ message: 'Invalid event filter' }, { status: 400 });
      conditions.push('(SELECT type FROM delivery_events WHERE provider_id = email_history.provider_id ORDER BY occurred_at DESC, id DESC LIMIT 1) = ?'); values.push(lastEvent);
    }
    if (cursor !== null) {
      const anchor = await env.DB.prepare('SELECT id, created_at FROM email_history WHERE id = ?').bind(cursor).first<{ id: string; created_at: string }>();
      if (!anchor) return Response.json({ message: 'Invalid cursor' }, { status: 400 });
      conditions.push(before !== null ? '(created_at, email_history.id) > (?, ?)' : '(created_at, email_history.id) < (?, ?)');
      values.push(anchor.created_at, anchor.id);
    }
    const direction = before !== null ? 'ASC' : 'DESC';
    const limit = Number(raw);
    const condition = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await env.DB.prepare(`SELECT ${fields} FROM ${tables} ${condition} ORDER BY created_at ${direction}, email_history.id ${direction} LIMIT ?`).bind(...values, limit + 1).all<HistoryRow>();
    const rows = result.results.slice(0, limit);
    if (before !== null) rows.reverse();
    return Response.json({ object: 'list', has_more: result.results.length > limit, data: rows.map(format) }, { headers: { 'cache-control': 'no-store' } });
  }
  const eventsMatch = url.pathname.match(/^\/emails\/([0-9a-f-]{36})\/events$/);
  if (eventsMatch) {
    const params = url.searchParams;
    if ([...params.keys()].some(key => !['limit', 'after'].includes(key)) || ['limit', 'after'].some(key => params.getAll(key).length > 1)) return Response.json({ message: 'Unsupported or duplicate query parameter' }, { status: 400 });
    const raw = params.get('limit') ?? '20'; const after = params.get('after');
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100 || after === '') return Response.json({ message: 'Invalid pagination' }, { status: 400 });
    const email = await env.DB.prepare('SELECT provider_id FROM email_history WHERE id = ?').bind(eventsMatch[1]).first<{ provider_id: string | null }>();
    if (!email) return Response.json({ message: 'Not found' }, { status: 404 });
    let condition = ''; let values: string[] = [];
    if (after !== null) {
      const anchor = await env.DB.prepare('SELECT id, occurred_at FROM delivery_events WHERE provider_id = ? AND id = ?').bind(email.provider_id, after).first<{ id: string; occurred_at: string }>();
      if (!anchor) return Response.json({ message: 'Invalid cursor' }, { status: 400 });
      condition = 'AND (occurred_at, id) > (?, ?)'; values = [anchor.occurred_at, anchor.id];
    }
    const result = await env.DB.prepare(`SELECT id, recipient, type, occurred_at, details FROM delivery_events WHERE provider_id = ? ${condition} ORDER BY occurred_at ASC, id ASC LIMIT ?`).bind(email.provider_id, ...values, Number(raw) + 1).all<{ id: string; recipient: string; type: string; occurred_at: string; details: string }>();
    return Response.json({ object: 'list', data: result.results.slice(0, Number(raw)).map(event => ({ ...event, details: JSON.parse(event.details) })), has_more: result.results.length > Number(raw) }, { headers: { 'cache-control': 'no-store' } });
  }
  const attachmentListMatch = url.pathname.match(/^\/emails\/([0-9a-f-]{36})\/attachments$/);
  if (attachmentListMatch) {
    const detail = await readHistory(new Request(new URL(`/emails/${attachmentListMatch[1]}`, url)), env);
    if (!detail.ok) return detail;
    const data = await detail.json() as { attachments: unknown[] | null };
    return data.attachments === null ? Response.json({ message: 'Attachment metadata is unavailable' }, { status: 404, headers: { 'cache-control': 'no-store' } }) : attachmentList(data.attachments, url.searchParams);
  }
  const attachmentMatch = url.pathname.match(/^\/emails\/([0-9a-f-]{36})\/attachments\/(\d+)$/);
  if (attachmentMatch) {
    const row = await env.DB.prepare('SELECT email_history.body_stored, scheduled_emails.state AS schedule_state FROM email_history LEFT JOIN scheduled_emails ON scheduled_emails.id = email_history.id WHERE email_history.id = ?').bind(attachmentMatch[1]).first<{ body_stored: number; schedule_state: string | null }>();
    if (!row || row.schedule_state === 'canceled') return Response.json({ message: 'Not found' }, { status: 404 });
    try {
      const stored = row.body_stored ? await readSentContent(env.INBOUND, attachmentMatch[1]) : await readScheduledContent(env, attachmentMatch[1]);
      if (!stored && row.body_stored) throw new Error('Missing content');
      const attachment = stored?.attachments?.[Number(attachmentMatch[2])];
      if (!attachment) return Response.json({ message: 'Not found' }, { status: 404 });
      const bytes = Uint8Array.from(atob(attachment.content), char => char.charCodeAt(0));
      const filename = encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(attachment.filename))).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength), 'content-disposition': `attachment; filename*=UTF-8''${filename}`, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
    } catch { return Response.json({ message: 'Email content is unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
  }
  const id = url.pathname.slice('/emails/'.length);
  const row = await env.DB.prepare(`SELECT ${fields}, provider_id, body_stored FROM ${tables} WHERE email_history.id = ?`).bind(id).first<HistoryRow & { provider_id: string | null; body_stored: number }>();
  if (!row) return Response.json({ message: 'Not found' }, { status: 404 });
  let html: string | null = null; let text: string | null = null; let attachments: { id: string; filename: string; content_type: string; size: number }[] | null = null;
  if (row.schedule_state === 'scheduled') {
    try {
      const scheduled = await readScheduledContent(env, id);
      if (scheduled) { html = scheduled.html; text = scheduled.text; attachments = attachmentMetadata(scheduled.attachments); }
    } catch { return Response.json({ message: 'Scheduled content is unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
  }
  if (row.body_stored && row.schedule_state !== 'canceled') {
    try {
      const content = await readSentContent(env.INBOUND, id);
      if (!content) throw new Error('Missing email content');
      html = content.html; text = content.text;
      attachments = content.attachments ? attachmentMetadata(content.attachments) : null;
    } catch { return Response.json({ message: 'Email content is unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
  }
  const events = row.provider_id ? await env.DB.prepare('SELECT recipient, type, occurred_at, details FROM delivery_events WHERE provider_id = ? ORDER BY occurred_at ASC, id ASC LIMIT 101').bind(row.provider_id).all<{ recipient: string; type: string; occurred_at: string; details: string }>() : { results: [] }; 
  return Response.json({ object: 'email', ...format(row), html, text, attachments, delivery_events: events.results.slice(0, 100).map(event => ({ ...event, details: JSON.parse(event.details) })), delivery_events_has_more: events.results.length > 100 }, { headers: { 'cache-control': 'no-store' } });
}
