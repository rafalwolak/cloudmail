export interface DomainAuthorization { zoneId: string; accessToken: string }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export function incompleteResults(info: unknown, returned: number): boolean {
  if (info === undefined || info === null) return false;
  if (typeof info !== 'object' || Array.isArray(info)) return true;
  const metadata = info as Record<string, unknown>;
  for (const field of ['page', 'total_pages', 'total_count']) {
    if (metadata[field] !== undefined && (!Number.isSafeInteger(metadata[field]) || Number(metadata[field]) < 0)) return true;
  }
  return Number(metadata.page ?? 1) > 1 || Number(metadata.total_pages ?? 1) > 1 || Number(metadata.total_count ?? returned) > returned;
}

export async function manageDomains(request: Request, authorization: DomainAuthorization | null): Promise<Response> {
  const url = new URL(request.url); const match = url.pathname.match(/^\/domains(?:\/([0-9a-f]{32})(\/dns)?)?$/);
  if (!match) return json({ message: 'Not found' }, 404);
  if ([...url.searchParams.keys()].length) return json({ message: 'Unsupported query parameter' }, 400);
  const [, id, dns] = match;
  if (!((!id && ['GET', 'POST'].includes(request.method)) || (id && !dns && ['GET', 'DELETE'].includes(request.method)) || (id && dns && request.method === 'GET'))) return json({ message: 'Not found' }, 404);
  if (!authorization?.accessToken || !/^[0-9a-f]{32}$/i.test(authorization.zoneId)) return json({ message: 'Cloudflare domain management is not configured' }, 503);
  let body: string | undefined;
  if (request.method === 'POST') {
    let value: unknown; try { value = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'name') || typeof (value as { name?: unknown }).name !== 'string' || !/^(?=.{1,253}$)(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test((value as { name: string }).name)) return json({ message: 'A valid domain name is required' }, 400);
    body = JSON.stringify({ name: (value as { name: string }).name.toLowerCase() });
  }
  try {
    const target = `https://api.cloudflare.com/client/v4/zones/${authorization.zoneId}/email/sending/subdomains${id ? `/${id}` : ''}${dns ?? ''}`;
    const response = await fetch(target, { method: request.method, headers: { authorization: `Bearer ${authorization.accessToken}`, ...(body && { 'content-type': 'application/json' }) }, ...(body && { body }), redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const result = await response.json() as { success?: boolean; result?: unknown; result_info?: { page?: number; total_pages?: number; total_count?: number } };
    if (!response.ok || result.success !== true) return json({ message: 'Cloudflare domain request failed', upstream_status: response.status }, response.status === 404 ? 404 : 502);
    if (!id && request.method === 'GET') {
      if (!Array.isArray(result.result) || result.result.some(item => !item || typeof item !== 'object' || typeof item.name !== 'string' || typeof item.enabled !== 'boolean' || typeof item.tag !== 'string' || !/^[0-9a-f]{32}$/i.test(item.tag))) return json({ message: 'Invalid Cloudflare domain response' }, 502);
      return json({ object: 'list', data: result.result, incomplete: incompleteResults(result.result_info, result.result.length), ...(result.result_info && { result_info: result.result_info }) });
    }
    if (request.method === 'DELETE') return json({ id, deleted: true });
    return json({ object: dns ? 'domain_dns' : 'domain', data: result.result, ...(dns && Array.isArray(result.result) && { incomplete: incompleteResults(result.result_info, result.result.length) }), ...(dns && result.result_info && { result_info: result.result_info }) }, request.method === 'POST' ? 201 : 200);
  } catch { return json({ message: 'Cloudflare domain request could not be confirmed' }, 502); }
}
