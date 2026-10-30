const requiredEvents = ['message.delivered', 'message.deferred', 'message.bounced', 'message.failed', 'message.rejected', 'message.complained'] as const;

interface Subscription {
  id: string;
  enabled: boolean;
  destination: { type: string; queue_id: string };
  source: { type: string; zone_id?: string; domain?: string };
  events: string[];
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
