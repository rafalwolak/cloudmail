import type { AuthEnv } from './auth';

const eventTypes = ['delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'] as const;

export async function readMetrics(request: Request, env: AuthEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['start_date', 'end_date'].includes(key)) || ['start_date', 'end_date'].some(key => params.getAll(key).length > 1)) return Response.json({ message: 'Unsupported or duplicate query parameter' }, { status: 400 });
  const now = Date.now();
  const parseDate = (value: string | null, fallback: number): number => {
    if (value === null) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : NaN;
  };
  const start = parseDate(params.get('start_date'), now - 7 * 86400000);
  const end = parseDate(params.get('end_date'), now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 366 * 86400000) return Response.json({ message: 'Provide a valid UTC interval of at most 366 days, with start_date before end_date' }, { status: 400 });
  const startDate = new Date(start).toISOString();
  const endDate = new Date(end).toISOString();
  const sent = await env.DB.prepare("SELECT COUNT(*) AS count FROM email_history WHERE status = 'accepted' AND created_at >= ? AND created_at < ?").bind(startDate, endDate).first<{ count: number }>();
  const events = await env.DB.prepare("SELECT type, COUNT(*) AS count FROM (SELECT DISTINCT type, provider_id, lower(recipient) FROM delivery_events WHERE type IN ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained') AND occurred_at >= ? AND occurred_at < ?) GROUP BY type").bind(startDate, endDate).all<{ type: string; count: number }>();
  const totals: Record<string, number> = { sent: sent?.count ?? 0 };
  for (const type of eventTypes) totals[type] = 0;
  for (const event of events.results) totals[event.type] = event.count;
  return Response.json({ object: 'metrics', start_date: startDate, end_date: endDate, totals }, { headers: { 'cache-control': 'no-store' } });
}
