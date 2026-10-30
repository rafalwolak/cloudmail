import type { AuthEnv } from './auth';
import type { OutboundEmail } from './email';

export class IdempotencyConflict extends Error {
  constructor(public code: string) { super(code); }
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sendRecordedEmail(env: AuthEnv, email: OutboundEmail, idempotencyKey?: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const to = Array.isArray(email.to) ? email.to : [email.to];
  const keyHash = idempotencyKey ? await digest(idempotencyKey) : null;
  const requestHash = keyHash ? await digest(JSON.stringify(email)) : null;
  if (keyHash) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE email_history SET idempotency_key_hash = NULL WHERE idempotency_key_hash = ? AND created_at < ?').bind(keyHash, cutoff).run();
  }
  const insert = await env.DB.prepare('INSERT INTO email_history (id, sender, recipients, subject, status, created_at, idempotency_key_hash, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key_hash) DO NOTHING')
    .bind(id, email.from, JSON.stringify(to), email.subject, 'pending', new Date().toISOString(), keyHash, requestHash).run();
  if (!insert.meta.changes) {
    const existing = await env.DB.prepare('SELECT id, request_hash, status FROM email_history WHERE idempotency_key_hash = ?').bind(keyHash).first<{ id: string; request_hash: string; status: string }>();
    if (!existing || existing.request_hash !== requestHash) throw new IdempotencyConflict('invalid_idempotent_request');
    if (existing.status !== 'accepted') throw new IdempotencyConflict('concurrent_or_uncertain_idempotent_request');
    return { id: existing.id };
  }
  let result: { messageId: string };
  try {
    result = await env.EMAIL.send(email);
  } catch (error) {
    try { await env.DB.prepare("UPDATE email_history SET status = 'unknown' WHERE id = ?").bind(id).run(); }
    catch { console.error('Could not update email history after send error'); }
    throw error;
  }
  try { await env.DB.prepare("UPDATE email_history SET status = 'accepted', provider_id = ? WHERE id = ?").bind(result.messageId, id).run(); }
  catch { console.error('Could not update email history after acceptance'); }
  return { id };
}

interface HistoryRow { id: string; sender: string; recipients: string; subject: string; status: string; created_at: string }
function format(row: HistoryRow) {
  return { id: row.id, from: row.sender, to: JSON.parse(row.recipients), subject: row.subject, status: row.status, created_at: row.created_at };
}

export async function readHistory(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const fields = 'id, sender, recipients, subject, status, created_at';
  if (url.pathname === '/emails') {
    const params = url.searchParams;
    if ([...params.keys()].some(key => !['limit', 'before', 'after'].includes(key)) || ['limit', 'before', 'after'].some(key => params.getAll(key).length > 1)) return Response.json({ message: 'Unsupported or duplicate query parameter' }, { status: 400 });
    const raw = params.get('limit') ?? '20';
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return Response.json({ message: 'limit must be between 1 and 100' }, { status: 400 });
    const before = params.get('before');
    const after = params.get('after');
    if ((before !== null && after !== null) || before === '' || after === '') return Response.json({ message: 'Provide only one valid cursor' }, { status: 400 });
    const cursor = before ?? after;
    let condition = '';
    let values: (string | number)[] = [];
    if (cursor !== null) {
      const anchor = await env.DB.prepare('SELECT id, created_at FROM email_history WHERE id = ?').bind(cursor).first<{ id: string; created_at: string }>();
      if (!anchor) return Response.json({ message: 'Invalid cursor' }, { status: 400 });
      condition = before !== null ? 'WHERE (created_at, id) > (?, ?)' : 'WHERE (created_at, id) < (?, ?)';
      values = [anchor.created_at, anchor.id];
    }
    const direction = before !== null ? 'ASC' : 'DESC';
    const limit = Number(raw);
    const result = await env.DB.prepare(`SELECT ${fields} FROM email_history ${condition} ORDER BY created_at ${direction}, id ${direction} LIMIT ?`).bind(...values, limit + 1).all<HistoryRow>();
    const rows = result.results.slice(0, limit);
    if (before !== null) rows.reverse();
    return Response.json({ object: 'list', has_more: result.results.length > limit, data: rows.map(format) }, { headers: { 'cache-control': 'no-store' } });
  }
  const id = url.pathname.slice('/emails/'.length);
  const row = await env.DB.prepare(`SELECT ${fields} FROM email_history WHERE id = ?`).bind(id).first<HistoryRow>();
  return row ? Response.json(format(row), { headers: { 'cache-control': 'no-store' } }) : Response.json({ message: 'Not found' }, { status: 404 });
}
