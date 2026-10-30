import type { AuthEnv } from './auth';
import { allowedSender, parseEmail, type OutboundEmail } from './email';
import { sendRecordedEmail } from './history';
import { resolveTemplate } from './templates';

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sendBatch(request: Request, env: AuthEnv, sendingDomain: string | null = null): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ message: 'Invalid JSON' }, { status: 400 }); }
  if (!Array.isArray(body) || body.length < 1 || body.length > 100) return Response.json({ message: 'Batch must contain 1-100 messages' }, { status: 400 });
  if (request.headers.has('x-batch-validation')) return Response.json({ message: 'Batch validation modes are not supported' }, { status: 400 });
  const emails: OutboundEmail[] = [];
  for (const [index, item] of body.entries()) {
    const resolved = await resolveTemplate(item, env);
    if (typeof resolved === 'string') return Response.json({ message: resolved, index }, { status: 400 });
    const parsed = parseEmail(resolved);
    if (typeof parsed === 'string') return Response.json({ message: parsed, index }, { status: 400 });
    if (!allowedSender(parsed, sendingDomain)) return Response.json({ message: 'Sender is not permitted for this key', index }, { status: 403 });
    emails.push(parsed);
  }
  const key = request.headers.get('Idempotency-Key');
  if (key !== null && (key.length < 1 || key.length > 256)) return Response.json({ message: 'Idempotency-Key must be 1-256 characters' }, { status: 400 });
  const batchId = crypto.randomUUID();
  if (key !== null) {
    const keyHash = await digest(key);
    const requestHash = await digest(JSON.stringify(emails));
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('DELETE FROM batch_requests WHERE key_hash = ? AND created_at < ?').bind(keyHash, cutoff).run();
    const inserted = await env.DB.prepare("INSERT INTO batch_requests (id, key_hash, request_hash, state, created_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(key_hash) DO NOTHING").bind(batchId, keyHash, requestHash, new Date().toISOString()).run();
    if (!inserted.meta.changes) {
      const previous = await env.DB.prepare('SELECT request_hash, state, results FROM batch_requests WHERE key_hash = ?').bind(keyHash).first<{ request_hash: string; state: string; results: string | null }>();
      if (!previous || previous.request_hash !== requestHash) return Response.json({ message: 'invalid_idempotent_request' }, { status: 409 });
      if (previous.state !== 'completed' || !previous.results) return Response.json({ message: 'Batch is in progress or has an uncertain outcome. Inspect history before retrying.' }, { status: 409 });
      return Response.json({ data: JSON.parse(previous.results) });
    }
  }
  const results: { id: string }[] = [];
  for (const [index, email] of emails.entries()) {
    try { results.push(await sendRecordedEmail(env, email)); }
    catch {
      if (key !== null) {
        try { await env.DB.prepare("UPDATE batch_requests SET state = 'uncertain', results = ? WHERE id = ?").bind(JSON.stringify(results), batchId).run(); }
        catch { console.error('Could not update batch state'); }
      }
      return Response.json({ message: 'Batch stopped. Check history before retrying; delivery may be uncertain.', data: results, failed_index: index }, { status: 502 });
    }
  }
  if (key !== null) {
    try { await env.DB.prepare("UPDATE batch_requests SET state = 'completed', results = ? WHERE id = ?").bind(JSON.stringify(results), batchId).run(); }
    catch { console.error('Could not update batch state after acceptance'); }
  }
  return Response.json({ data: results });
}
