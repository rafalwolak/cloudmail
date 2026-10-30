import type { AuthEnv } from './auth';
import type { OutboundEmail } from './email';
import { IdempotencyConflict, digest, serializeRecipients } from './history';
import { cleanOrphanedScheduledPayloads } from './scheduled-cleanup';

type ScheduleEnv = AuthEnv & { INBOUND: R2Bucket };

export function validateSchedule(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null;
  const relative = /^in ([1-9]\d*) (second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|day|days)$/.exec(value);
  let time: number;
  if (relative) {
    const unit = relative[2];
    const multiplier = unit.startsWith('s') ? 1000 : unit.startsWith('m') ? 60000 : unit.startsWith('h') ? 3600000 : 86400000;
    time = now + Number(relative[1]) * multiplier;
  } else {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
    time = Date.parse(value);
  }
  if (!Number.isFinite(time) || time <= now || time > now + 30 * 86400000) return null;
  return new Date(time).toISOString();
}

export async function scheduleEmail(env: ScheduleEnv, email: OutboundEmail, scheduledAt: string, key?: string, requestedAt = scheduledAt): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const keyHash = key ? await digest(key) : null;
  const requestHash = keyHash ? await digest(JSON.stringify({ email, scheduled_at: requestedAt.startsWith('in ') ? requestedAt : scheduledAt })) : null;
  if (keyHash) await env.DB.prepare('UPDATE email_history SET idempotency_key_hash = NULL WHERE idempotency_key_hash = ? AND created_at < ?').bind(keyHash, new Date(Date.now() - 86400000).toISOString()).run();
  const now = new Date().toISOString();
  const payload = JSON.stringify(email);
  const objectKey = new TextEncoder().encode(payload).byteLength > 1500000 ? `scheduled/${id}` : null;
  if (objectKey) await env.INBOUND.put(objectKey, payload);
  // A failed response can follow a committed transaction; keep the payload for investigation.
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO email_history (id, sender, recipients, subject, status, created_at, idempotency_key_hash, request_hash, tags, cc, bcc, reply_to) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key_hash) DO NOTHING").bind(id, email.from, JSON.stringify(Array.isArray(email.to) ? email.to : [email.to]), email.subject, now, keyHash, requestHash, JSON.stringify(email.tags ?? []), serializeRecipients(email.cc), serializeRecipients(email.bcc), email.replyTo ?? null),
    env.DB.prepare("INSERT INTO scheduled_emails (id, scheduled_at, state, payload, payload_r2_key) SELECT id, ?, 'scheduled', ?, ? FROM email_history WHERE id = ?").bind(scheduledAt, objectKey ? null : payload, objectKey, id),
  ]);
  if (!results[0].meta.changes) {
    if (objectKey) try { await env.INBOUND.delete(objectKey); } catch { console.error('Could not remove duplicate scheduled payload'); }
    const existing = await env.DB.prepare('SELECT id, request_hash FROM email_history WHERE idempotency_key_hash = ?').bind(keyHash).first<{ id: string; request_hash: string }>();
    if (!existing || existing.request_hash !== requestHash) throw new IdempotencyConflict('invalid_idempotent_request');
    return { id: existing.id };
  }
  return { id };
}

export async function manageSchedule(request: Request, env: ScheduleEnv): Promise<Response> {
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
    if (!scheduledAt) return Response.json({ message: 'scheduled_at must be a future ISO 8601 time or relative duration within 30 days' }, { status: 400 });
    result = await env.DB.prepare("UPDATE scheduled_emails SET scheduled_at = ? WHERE id = ? AND state = 'scheduled'").bind(scheduledAt, id).run();
  } else return Response.json({ message: 'Not found' }, { status: 404 });
  if (!result.meta.changes) {
    const existing = await env.DB.prepare('SELECT id FROM email_history WHERE id = ?').bind(id).first();
    return Response.json({ message: existing ? 'Email cannot be changed' : 'Not found' }, { status: existing ? 409 : 404 });
  }
  return Response.json({ id });
}

export async function processScheduled(env: ScheduleEnv): Promise<void> {
  try { await cleanOrphanedScheduledPayloads(env.DB, env.INBOUND); }
  catch { console.error('Could not scan orphaned scheduled payloads; cleanup will retry'); }
  const cleanup = await env.DB.prepare("SELECT id, payload_r2_key FROM scheduled_emails WHERE state IN ('accepted', 'unknown', 'canceled') AND payload_r2_key IS NOT NULL LIMIT 20").all<{ id: string; payload_r2_key: string }>();
  for (const item of cleanup.results) {
    try {
      await env.INBOUND.delete(item.payload_r2_key);
      await env.DB.prepare('UPDATE scheduled_emails SET payload_r2_key = NULL WHERE id = ? AND payload_r2_key = ?').bind(item.id, item.payload_r2_key).run();
    } catch { console.error('Could not remove scheduled payload; cleanup will retry'); }
  }
  const rows = await env.DB.prepare("SELECT id FROM scheduled_emails WHERE state = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 20").bind(new Date().toISOString()).all<{ id: string }>();
  for (const { id } of rows.results) {
    const claimed = await env.DB.prepare("UPDATE scheduled_emails SET state = 'sending' WHERE id = ? AND state = 'scheduled' AND scheduled_at <= ? RETURNING payload, payload_r2_key").bind(id, new Date().toISOString()).first<{ payload: string | null; payload_r2_key: string | null }>();
    if (!claimed) continue;
    try {
      const object = claimed.payload_r2_key ? await env.INBOUND.get(claimed.payload_r2_key) : null;
      const payload = claimed.payload_r2_key ? await object?.text() : claimed.payload;
      if (!payload) throw new Error('Scheduled payload is unavailable');
      const { tags: _tags, ...message } = JSON.parse(payload) as OutboundEmail;
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
