import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeliveryEvent, processDeliveryBatch } from '../src/delivery-events.ts';

const event = { type: 'cf.email.sending.message.delivered', source: { type: 'email.sending', domain: 'example.com' }, payload: { eventId: 'event-1', messageId: 'provider-1', recipient: 'user@example.com' }, metadata: { eventTimestamp: '2026-10-30T10:00:00.000Z' } };

test('accepts documented delivery events and rejects unrelated input', () => {
  assert.deepEqual(parseDeliveryEvent(event), { id: 'event-1', providerId: 'provider-1', recipient: 'user@example.com', type: 'delivered', timestamp: '2026-10-30T10:00:00.000Z' });
  assert.equal(parseDeliveryEvent({ ...event, type: 'unrelated' }), null);
  assert.equal(parseDeliveryEvent({ ...event, payload: {} }), null);
});

test('queue acknowledges recorded events and retries database failures', async () => {
  const calls = [];
  const db = { prepare(sql) { return { bind(...values) { return { async run() { calls.push({ sql, values }); if (values[0] === 'fail') throw new Error('db unavailable'); } }; } }; } };
  const makeMessage = body => ({ body, acked: false, retried: false, ack() { this.acked = true; }, retry() { this.retried = true; } });
  const valid = makeMessage(event);
  const invalid = makeMessage({});
  const failure = makeMessage({ ...event, payload: { ...event.payload, eventId: 'fail' } });
  await processDeliveryBatch({ messages: [valid, invalid, failure] }, db);
  assert.equal(valid.acked, true);
  assert.equal(invalid.acked, true);
  assert.equal(failure.retried, true);
  assert.match(calls[0].sql, /ON CONFLICT.*DO NOTHING/i);
});
