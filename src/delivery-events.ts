interface DeliveryEvent { id: string; providerId: string; recipient: string; type: string; timestamp: string; details: Record<string, string | number | boolean> }
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
  const delivery = record(payload.delivery); const bounce = record(payload.bounce); const complaint = record(payload.complaint);
  const failure = record(payload.failure); const rejection = record(payload.rejection);
  const details: Record<string, string | number | boolean> = {};
  const fields = [
    ['smtp_status_code', delivery?.smtpStatusCode], ['smtp_enhanced_status_code', delivery?.smtpEnhancedStatusCode],
    ['smtp_response', delivery?.smtpResponse], ['bounce_type', bounce?.type], ['bounce_classification', bounce?.classification],
    ['bounce_reason', bounce?.reason], ['complaint_type', complaint?.type], ['provider', delivery?.provider],
    ['failure_reason', failure?.reason], ['rejection_reason', rejection?.reason], ['rejection_party', rejection?.party], ['rejection_detail', rejection?.detail],
  ] as const;
  for (const [key, value] of fields) if (typeof value === 'string' && value.length > 0 && value.length <= 2048) details[key] = value;
  if (typeof delivery?.deliveryTimeMs === 'number' && Number.isFinite(delivery.deliveryTimeMs) && delivery.deliveryTimeMs >= 0) details.delivery_time_ms = delivery.deliveryTimeMs;
  if (typeof payload.terminal === 'boolean') details.terminal = payload.terminal;
  return { id: payload.eventId, providerId: payload.messageId, recipient: payload.recipient, type, timestamp: new Date(metadata.eventTimestamp).toISOString(), details };
}

export async function processDeliveryBatch(batch: Pick<MessageBatch<unknown>, 'messages'>, db: D1Database): Promise<void> {
  for (const message of batch.messages) {
    const event = parseDeliveryEvent(message.body);
    if (!event) { message.ack(); continue; }
    try {
      await db.prepare('INSERT INTO delivery_events (id, provider_id, recipient, type, occurred_at, details) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(event.id, event.providerId, event.recipient, event.type, event.timestamp, JSON.stringify(event.details)).run();
      message.ack();
    } catch {
      message.retry();
    }
  }
}
