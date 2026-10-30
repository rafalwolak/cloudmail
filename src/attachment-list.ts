export function attachmentList<T>(items: T[], params: URLSearchParams): Response {
  const keys = ['limit', 'before', 'after'];
  const raw = params.get('limit') ?? '20'; const before = params.get('before'); const after = params.get('after');
  if ([...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length > 1) || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100 || (before !== null && after !== null)) return Response.json({ message: 'Invalid pagination' }, { status: 400 });
  const cursor = before ?? after;
  if (cursor !== null && (!/^(0|[1-9]\d*)$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) >= items.length)) return Response.json({ message: 'Invalid cursor' }, { status: 400 });
  const limit = Number(raw);
  const end = before !== null ? Number(before) : Math.min(items.length, (after === null ? 0 : Number(after) + 1) + limit);
  const start = before !== null ? Math.max(0, end - limit) : after === null ? 0 : Number(after) + 1;
  return Response.json({ object: 'list', data: items.slice(start, end), has_more: before !== null ? start > 0 : end < items.length }, { headers: { 'cache-control': 'no-store' } });
}
