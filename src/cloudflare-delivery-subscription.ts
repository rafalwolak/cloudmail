const requiredEvents = ['message.delivered', 'message.deferred', 'message.bounced', 'message.failed', 'message.rejected', 'message.complained'] as const;

interface Subscription {
  id: string;
  enabled: boolean;
  destination: { type: string; queue_id: string };
  source: { type: string; zone_id?: string; domain?: string };
  events: string[];
}

async function listCloudflarePages(token: string, base: URL): Promise<unknown[]> {
  const items: unknown[] = []; let expectedTotal: number | undefined;
  for (let page = 1; page <= 20; page++) {
    const url = new URL(base); url.searchParams.set('page', String(page)); url.searchParams.set('per_page', '100');
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Cloudflare queue access failed');
    const body = await response.json() as { success?: unknown; result?: unknown; result_info?: { page?: unknown; total_pages?: unknown; total_count?: unknown } };
    const info = body.result_info;
    if (body.success !== true || !Array.isArray(body.result) || !info || info.page !== page || !Number.isSafeInteger(info.total_pages) || Number(info.total_pages) < 0 || !Number.isSafeInteger(info.total_count) || Number(info.total_count) < 0) throw new Error('Incomplete Cloudflare pagination');
    if (expectedTotal !== undefined && expectedTotal !== info.total_count) throw new Error('Cloudflare results changed during pagination');
    expectedTotal = Number(info.total_count); items.push(...body.result);
    if (page >= Number(info.total_pages)) {
      if (items.length !== expectedTotal) throw new Error('Incomplete Cloudflare results');
      return items;
    }
  }
  throw new Error('Cloudflare pagination limit exceeded');
}

export async function inspectDeliverySubscription(token: string, accountId: string, queueName: string, zoneId: string, domain: string) {
  if (!token || !/^[a-f0-9]{32}$/i.test(accountId) || !/^[a-z0-9_-]{1,63}$/i.test(queueName)) throw new Error('Invalid Cloudflare queue target');
  const queueUrl = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/queues`); queueUrl.searchParams.set('name', queueName);
  const queues = await listCloudflarePages(token, queueUrl);
  const matches = queues.filter((item): item is { queue_name: string; queue_id: string } => !!item && typeof item === 'object' && 'queue_name' in item && item.queue_name === queueName && 'queue_id' in item && typeof item.queue_id === 'string' && /^[a-f0-9]{32}$/i.test(item.queue_id));
  if (matches.length !== 1) throw new Error('Cloudflare queue could not be identified');
  const queueId = matches[0].queue_id;
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/event_subscriptions/subscriptions`); url.searchParams.set('queue_id', queueId);
  const items = await listCloudflarePages(token, url);
  const subscriptions = items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid Cloudflare subscription');
    const value = item as Partial<Subscription>;
    if (typeof value.id !== 'string' || !value.id || typeof value.enabled !== 'boolean' || !value.destination || typeof value.destination.type !== 'string' || typeof value.destination.queue_id !== 'string' || !value.source || typeof value.source.type !== 'string' || !Array.isArray(value.events) || value.events.some(event => typeof event !== 'string')) throw new Error('Invalid Cloudflare subscription');
    if (value.source.type === 'email.sending' && (typeof value.source.zone_id !== 'string' || typeof value.source.domain !== 'string')) throw new Error('Invalid Cloudflare subscription source');
    return value as Subscription;
  });
  return planDeliverySubscription(subscriptions, queueId, zoneId, domain);
}

export function planDeliverySubscription(subscriptions: Subscription[], queueId: string, zoneId: string, domain: string):
  | { action: 'create'; request: { name: string; enabled: true; destination: { type: 'queues.queue'; queue_id: string }; source: { type: 'email.sending'; zone_id: string; domain: string }; events: string[] } }
  | { action: 'ready'; id: string }
  | { action: 'conflict'; ids: string[] } {
  if (!/^[a-f0-9]{32}$/i.test(queueId) || !/^[a-f0-9]{32}$/i.test(zoneId) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) throw new Error('Invalid delivery subscription target');
  const normalizedDomain = domain.toLowerCase();
  const matches = subscriptions.filter(item => item.destination.type === 'queues.queue' && item.destination.queue_id.toLowerCase() === queueId.toLowerCase() && item.source.type === 'email.sending' && item.source.zone_id?.toLowerCase() === zoneId.toLowerCase() && item.source.domain?.toLowerCase() === normalizedDomain);
  if (matches.length === 1 && matches[0].enabled && requiredEvents.every(event => matches[0].events.includes(event))) return { action: 'ready', id: matches[0].id };
  if (matches.length) return { action: 'conflict', ids: matches.map(item => item.id) };
  return { action: 'create', request: { name: `Cloudmail delivery: ${normalizedDomain}`, enabled: true, destination: { type: 'queues.queue', queue_id: queueId }, source: { type: 'email.sending', zone_id: zoneId, domain: normalizedDomain }, events: [...requiredEvents] } };
}
