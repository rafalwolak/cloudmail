import { listCloudflareZones } from './cloudflare-zones.ts';
import { addCloudflareZone, listSelectedCloudflareZones } from './cloudflare-zone-selection.ts';
import { refreshStoredCloudflareTokens } from './cloudflare-oauth-token.ts';

export async function handleCloudflareZones(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (url.pathname === '/api/cloudflare/zones' && request.method === 'GET') {
    if (url.search) return json({ message: 'Unsupported query parameter' }, 400);
    return json({ data: await listSelectedCloudflareZones(env.DB, userId) });
  }
  const available = url.pathname === '/api/cloudflare/zones/available' && request.method === 'GET';
  const add = url.pathname === '/api/cloudflare/zones' && request.method === 'POST';
  if (!available && !add) return json({ message: 'Not found' }, 404);
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return json({ message: 'Cloudflare integration is not configured' }, 503);
  let page = 1, zoneId = '';
  if (available) {
    if ([...url.searchParams.keys()].some(key => key !== 'page') || url.searchParams.getAll('page').length > 1 || !/^[1-9][0-9]{0,6}$/.test(url.searchParams.get('page') ?? '1')) return json({ message: 'Invalid page' }, 400);
    page = Number(url.searchParams.get('page') ?? '1');
  } else {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'zone_id') || !('zone_id' in body) || typeof body.zone_id !== 'string' || !/^[a-f0-9]{32}$/i.test(body.zone_id)) return json({ message: 'Invalid zone ID' }, 400);
    zoneId = body.zone_id;
  }
  try {
    const { accessToken } = await refreshStoredCloudflareTokens(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID);
    if (available) return json(await listCloudflareZones(accessToken, page));
    return json(await addCloudflareZone(env.DB, userId, accessToken, zoneId), 201);
  } catch { return json({ message: 'Cloudflare zones could not be retrieved or verified' }, 502); }
}
