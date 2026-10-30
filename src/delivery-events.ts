interface DeliveryEvent { id: string; providerId: string; recipient: string; type: string; timestamp: string }
const eventTypes = new Set(['delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained']);
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function parseDeliveryEvent(value: unknown): DeliveryEvent | null {
  const event = record(value);
  const source = record(event?.source);
  const payload = record(event?.payload);
  const metadata = record(event?.metadata);
  if (!event || !source || !payload || !metadata || source.type !== 'email.sending' || !text(event.type)) return null;
  const prefix = 'cf.email.sending.message.';
  const type = event.type.startsWith(prefix) ? event.type.slice(prefix.length) : '';
  if (!eventTypes.has(type) || !text(payload.eventId) || !text(payload.messageId) || !text(payload.recipient) || !text(metadata.eventTimestamp) || !Number.isFinite(Date.parse(metadata.eventTimestamp))) return null;
  return { id: payload.eventId, providerId: payload.messageId, recipient: payload.recipient, type, timestamp: new Date(metadata.eventTimestamp).toISOString() };
}

export async function processDeliveryBatch(batch: Pick<MessageBatch<unknown>, 'messages'>, db: D1Database): Promise<void> {
  for (const message of batch.messages) {
    const event = parseDeliveryEvent(message.body);
    if (!event) { message.ack(); continue; }
    try {
      await db.prepare('INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(event.id, event.providerId, event.recipient, event.type, event.timestamp).run();
      message.ack();
    } catch {
      message.retry();
    }
  }
}
