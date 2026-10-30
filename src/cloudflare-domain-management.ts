import { manageDomains } from './domains.ts';
import { refreshStoredCloudflareTokens } from './cloudflare-oauth-token.ts';

export async function manageSelectedZoneDomains(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string }, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/cloudflare\/zones\/([a-f0-9]{32})\/domains(?:\/([a-f0-9]{32})(\/dns)?)?$/i);
  if (!match) return Response.json({ message: 'Not found' }, { status: 404 });
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return Response.json({ message: 'Cloudflare integration is not configured' }, { status: 503 });
  const zoneId = match[1].toLowerCase();
  const zone = await env.DB.prepare('SELECT zone_id FROM cloudflare_zones WHERE user_id = ? AND zone_id = ?').bind(userId, zoneId).first<{ zone_id: string }>();
  if (!zone) return Response.json({ message: 'Cloudflare zone not found' }, { status: 404 });
  let accessToken: string;
  try { ({ accessToken } = await refreshStoredCloudflareTokens(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID)); }
  catch { return Response.json({ message: 'Cloudflare connection is unavailable; reconnect or retry' }, { status: 503 }); }
  url.pathname = `/domains${match[2] ? `/${match[2].toLowerCase()}${match[3]?.toLowerCase() ?? ''}` : ''}`;
  return manageDomains(new Request(url, request), { zoneId, accessToken });
}
