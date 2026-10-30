import type { AuthEnv } from './auth';
import type { OutboundEmail } from './email';
import { IdempotencyConflict, digest, serializeRecipients } from './history';

export function validateSchedule(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d)$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= Date.now() || time > Date.now() + 30 * 86400000) return null;
  return new Date(time).toISOString();
}

export async function scheduleEmail(env: AuthEnv, email: OutboundEmail, scheduledAt: string, key?: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const keyHash = key ? await digest(key) : null;
  const requestHash = keyHash ? await digest(JSON.stringify({ email, scheduled_at: scheduledAt })) : null;
  if (keyHash) await env.DB.prepare('UPDATE email_history SET idempotency_key_hash = NULL WHERE idempotency_key_hash = ? AND created_at < ?').bind(keyHash, new Date(Date.now() - 86400000).toISOString()).run();
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO email_history (id, sender, recipients, subject, status, created_at, idempotency_key_hash, request_hash, tags, cc, bcc, reply_to) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key_hash) DO NOTHING").bind(id, email.from, JSON.stringify(Array.isArray(email.to) ? email.to : [email.to]), email.subject, now, keyHash, requestHash, JSON.stringify(email.tags ?? []), serializeRecipients(email.cc), serializeRecipients(email.bcc), email.replyTo ?? null),
    env.DB.prepare("INSERT INTO scheduled_emails (id, scheduled_at, state, payload) SELECT id, ?, 'scheduled', ? FROM email_history WHERE id = ?").bind(scheduledAt, JSON.stringify(email), id),
  ]);
  if (!results[0].meta.changes) {
    const existing = await env.DB.prepare('SELECT id, request_hash FROM email_history WHERE idempotency_key_hash = ?').bind(keyHash).first<{ id: string; request_hash: string }>();
    if (!existing || existing.request_hash !== requestHash) throw new IdempotencyConflict('invalid_idempotent_request');
    return { id: existing.id };
  }
  return { id };
}

export async function manageSchedule(request: Request, env: AuthEnv): Promise<Response> {
  const match = new URL(request.url).pathname.match(/^\/emails\/([0-9a-f-]{36})(\/cancel)?$/);
  if (!match) return Response.json({ message: 'Not found' }, { status: 404 });
  const [id, cancel] = [match[1], !!match[2]];
  let result: D1Result;
  if (cancel && request.method === 'POST') {
    result = await env.DB.prepare("UPDATE scheduled_emails SET state = 'canceled', payload = NULL WHERE id = ? AND state = 'scheduled'").bind(id).run();
  } else if (!cancel && request.method === 'PATCH') {
    let body: unknown; try { body = await request.json(); } catch { return Response.json({ message: 'Invalid JSON' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'scheduled_at')) return Response.json({ message: 'Invalid schedule' }, { status: 400 });
    const scheduledAt = validateSchedule((body as { scheduled_at?: unknown }).scheduled_at);
    if (!scheduledAt) return Response.json({ message: 'scheduled_at must be an ISO 8601 time within 30 days' }, { status: 400 });
    result = await env.DB.prepare("UPDATE scheduled_emails SET scheduled_at = ? WHERE id = ? AND state = 'scheduled'").bind(scheduledAt, id).run();
  } else return Response.json({ message: 'Not found' }, { status: 404 });
  if (!result.meta.changes) {
    const existing = await env.DB.prepare('SELECT id FROM email_history WHERE id = ?').bind(id).first();
    return Response.json({ message: existing ? 'Email cannot be changed' : 'Not found' }, { status: existing ? 409 : 404 });
  }
  return Response.json({ id });
}

export async function processScheduled(env: AuthEnv): Promise<void> {
  const rows = await env.DB.prepare("SELECT id FROM scheduled_emails WHERE state = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 20").bind(new Date().toISOString()).all<{ id: string }>();
  for (const { id } of rows.results) {
    const claimed = await env.DB.prepare("UPDATE scheduled_emails SET state = 'sending' WHERE id = ? AND state = 'scheduled' AND scheduled_at <= ? RETURNING payload").bind(id, new Date().toISOString()).first<{ payload: string }>();
    if (!claimed) continue;
    try {
      const { tags: _tags, ...message } = JSON.parse(claimed.payload) as OutboundEmail;
      const sent = await env.EMAIL.send(message);
      await env.DB.batch([
        env.DB.prepare("UPDATE email_history SET status = 'accepted', provider_id = ? WHERE id = ?").bind(sent.messageId, id),
        env.DB.prepare("UPDATE scheduled_emails SET state = 'accepted', payload = NULL WHERE id = ?").bind(id),
      ]);
    } catch {
      await env.DB.batch([
        env.DB.prepare("UPDATE email_history SET status = 'unknown' WHERE id = ?").bind(id),
        env.DB.prepare("UPDATE scheduled_emails SET state = 'unknown', payload = NULL WHERE id = ?").bind(id),
      ]);
    }
  }
}
