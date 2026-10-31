import { manageDomains } from './domains.ts';
import { refreshStoredCloudflareTokens } from './cloudflare-oauth-token.ts';
import { inspectDeliverySubscription, ensureDeliverySubscription, CloudflareQueueAccessError } from './cloudflare-delivery-subscription.ts';

export async function manageSelectedZoneDomains(request: Request, env: { DB: D1Database; BETTER_AUTH_SECRET: string; CLOUDFLARE_OAUTH_CLIENT_ID?: string; DELIVERY_QUEUE_NAME?: string }, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/cloudflare\/zones\/([a-f0-9]{32})\/domains(?:\/([a-f0-9]{32})(\/(?:dns|delivery-events))?)?$/i);
  if (!match) return Response.json({ message: 'Not found' }, { status: 404 });
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return Response.json({ message: 'Cloudflare integration is not configured' }, { status: 503 });
  const zoneId = match[1].toLowerCase();
  const zone = await env.DB.prepare('SELECT zone_id, name, account_id FROM cloudflare_zones WHERE user_id = ? AND zone_id = ?').bind(userId, zoneId).first<{ zone_id: string; name: string; account_id: string }>();
  if (!zone) return Response.json({ message: 'Cloudflare zone not found' }, { status: 404 });
  const deliveryEvents = match[3]?.toLowerCase() === '/delivery-events';
  if (deliveryEvents && (url.search || !['GET', 'POST'].includes(request.method))) return Response.json({ message: 'Unsupported delivery event request' }, { status: 400 });
  if (deliveryEvents && !env.DELIVERY_QUEUE_NAME) return Response.json({ message: 'Delivery event queue is not configured' }, { status: 503 });
  let accessToken: string;
  try { ({ accessToken } = await refreshStoredCloudflareTokens(env.DB, env.BETTER_AUTH_SECRET, userId, env.CLOUDFLARE_OAUTH_CLIENT_ID)); }
  catch { return Response.json({ message: 'Cloudflare connection is unavailable; reconnect or retry' }, { status: 503 }); }
  if (deliveryEvents) {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
    const domainUrl = new URL(`/domains/${match[2].toLowerCase()}`, url);
    const response = await manageDomains(new Request(domainUrl), { zoneId, accessToken });
    if (!response.ok) return response;
    const domain = (await response.json() as { data?: { name?: unknown; enabled?: unknown } }).data;
    if (!domain || typeof domain.name !== 'string' || domain.enabled !== true || !(domain.name.toLowerCase() === zone.name.toLowerCase() || domain.name.toLowerCase().endsWith(`.${zone.name.toLowerCase()}`))) return json({ message: 'An enabled sending domain in the selected zone is required' }, 409);
    try {
      if (request.method === 'POST') return json(await ensureDeliverySubscription(env.DB, accessToken, zone.account_id, env.DELIVERY_QUEUE_NAME!, zoneId, domain.name));
      const result = await inspectDeliverySubscription(accessToken, zone.account_id, env.DELIVERY_QUEUE_NAME!, zoneId, domain.name);
      return json(result.action === 'create' ? { action: 'missing' } : result);
    } catch (error) {
      if (error instanceof CloudflareQueueAccessError) return json({ code: 'cloudflare_queue_access_required', message: 'Cloudflare queue access is missing or expired. Enable queue access for this installation’s OAuth client, then reconnect Cloudflare.' }, 502);
      return json({ message: 'Delivery event configuration could not be confirmed. Check Cloudflare queue permissions and existing subscriptions before retrying.' }, 502);
    }
  }
  url.pathname = `/domains${match[2] ? `/${match[2].toLowerCase()}${match[3]?.toLowerCase() ?? ''}` : ''}`;
  return manageDomains(new Request(url, request), { zoneId, accessToken });
}
