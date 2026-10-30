import type { AuthEnv } from './auth';
import type { OutboundEmail } from './email';

export async function sendRecordedEmail(env: AuthEnv, email: OutboundEmail): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const to = Array.isArray(email.to) ? email.to : [email.to];
  await env.DB.prepare('INSERT INTO email_history (id, sender, recipients, subject, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, email.from, JSON.stringify(to), email.subject, 'pending', new Date().toISOString()).run();
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
    if ([...url.searchParams.keys()].some(key => key !== 'limit')) return Response.json({ message: 'Unsupported query parameter' }, { status: 400 });
    const raw = url.searchParams.get('limit') ?? '20';
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) return Response.json({ message: 'limit must be between 1 and 100' }, { status: 400 });
    const result = await env.DB.prepare(`SELECT ${fields} FROM email_history ORDER BY created_at DESC, id DESC LIMIT ?`).bind(Number(raw)).all<HistoryRow>();
    return Response.json({ data: result.results.map(format) }, { headers: { 'cache-control': 'no-store' } });
  }
  const id = url.pathname.slice('/emails/'.length);
  const row = await env.DB.prepare(`SELECT ${fields} FROM email_history WHERE id = ?`).bind(id).first<HistoryRow>();
  return row ? Response.json(format(row), { headers: { 'cache-control': 'no-store' } }) : Response.json({ message: 'Not found' }, { status: 404 });
}
