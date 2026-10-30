import type { AuthEnv } from './auth';

const eventTypes = ['delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'] as const;
const supportedMetrics = ['sent', ...eventTypes];

export async function readMetrics(request: Request, env: AuthEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const supportedParams = ['start_date', 'end_date', 'metrics', 'dimensions', 'granularity'];
  if ([...params.keys()].some(key => !supportedParams.includes(key)) || supportedParams.some(key => params.getAll(key).length > 1)) return Response.json({ message: 'Unsupported or duplicate query parameter' }, { status: 400 });
  const selected = params.has('metrics') ? params.get('metrics')!.split(',') : supportedMetrics;
  if (selected.some(metric => !supportedMetrics.includes(metric)) || new Set(selected).size !== selected.length) return Response.json({ message: 'Unsupported or duplicate metric' }, { status: 400 });
  const dimensions = params.has('dimensions') ? params.get('dimensions')!.split(',') : [];
  if (dimensions.length > 1 || dimensions.some(dimension => dimension !== 'period')) return Response.json({ message: 'Only the period dimension is supported' }, { status: 400 });
  const granularity = params.get('granularity') ?? 'daily';
  if (!['hourly', 'daily'].includes(granularity)) return Response.json({ message: 'Only hourly and daily granularity are supported' }, { status: 400 });
  const now = Date.now();
  const parseDate = (value: string | null, fallback: number): number => {
    if (value === null) return fallback;
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) return NaN;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === normalized.slice(0, 19) ? parsed : NaN;
  };
  const end = parseDate(params.get('end_date'), now);
  const start = parseDate(params.get('start_date'), end - 7 * 86400000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 366 * 86400000) return Response.json({ message: 'Provide a valid UTC interval of at most 366 days, with start_date before end_date' }, { status: 400 });
  const startDate = new Date(start).toISOString();
  const endDate = new Date(end).toISOString();
  const sent = await env.DB.prepare("SELECT COUNT(*) AS count FROM email_history WHERE status = 'accepted' AND created_at >= ? AND created_at < ?").bind(startDate, endDate).first<{ count: number }>();
  const events = await env.DB.prepare("SELECT type, COUNT(*) AS count FROM (SELECT DISTINCT type, provider_id, lower(recipient) FROM delivery_events WHERE type IN ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained') AND occurred_at >= ? AND occurred_at < ?) GROUP BY type").bind(startDate, endDate).all<{ type: string; count: number }>();
  const totals: Record<string, number> = { sent: sent?.count ?? 0 };
  for (const type of eventTypes) totals[type] = 0;
  for (const event of events.results) totals[event.type] = event.count;
  const pick = (values: Record<string, number>) => Object.fromEntries(selected.map(metric => [metric, values[metric] ?? 0]));
  const data: Record<string, string | number>[] = [];
  if (dimensions.length) {
    const format = granularity === 'hourly' ? '%Y-%m-%dT%H:00:00.000Z' : '%Y-%m-%dT00:00:00.000Z';
    const sentPeriods = await env.DB.prepare("SELECT strftime(?, created_at) AS period, COUNT(*) AS count FROM email_history WHERE status = 'accepted' AND created_at >= ? AND created_at < ? GROUP BY period").bind(format, startDate, endDate).all<{ period: string; count: number }>();
    const eventPeriods = await env.DB.prepare("SELECT period, type, COUNT(*) AS count FROM (SELECT DISTINCT strftime(?, occurred_at) AS period, type, provider_id, lower(recipient) FROM delivery_events WHERE type IN ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained') AND occurred_at >= ? AND occurred_at < ?) GROUP BY period, type").bind(format, startDate, endDate).all<{ period: string; type: string; count: number }>();
    const periods = new Map<string, Record<string, number>>();
    for (const row of sentPeriods.results) periods.set(row.period, { sent: row.count });
    for (const row of eventPeriods.results) { const values = periods.get(row.period) ?? {}; values[row.type] = row.count; periods.set(row.period, values); }
    for (const [period, values] of [...periods].sort(([a], [b]) => a.localeCompare(b))) data.push({ period, ...pick(values) });
  }
  return Response.json({ object: 'metrics', start_date: startDate, end_date: endDate, metrics: selected, dimensions, granularity, totals: pick(totals), ...(dimensions.length ? { data } : {}) }, { headers: { 'cache-control': 'no-store' } });
}
