import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeliveryEvent, processDeliveryBatch } from '../src/delivery-events.ts';

const event = { type: 'cf.email.sending.message.delivered', source: { type: 'email.sending', domain: 'example.com' }, payload: { eventId: 'event-1', messageId: 'provider-1', recipient: 'user@example.com' }, metadata: { eventTimestamp: '2026-10-30T10:00:00.000Z' } };

test('accepts documented delivery events and rejects unrelated input', () => {
  assert.deepEqual(parseDeliveryEvent(event), { id: 'event-1', providerId: 'provider-1', recipient: 'user@example.com', type: 'delivered', timestamp: '2026-10-30T10:00:00.000Z', details: {} });
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
  assert.deepEqual(JSON.parse(calls[0].values[5]), {});
});

test('preserves bounded delivery and bounce diagnostics', () => {
  const bounced = { ...event, type: 'cf.email.sending.message.bounced', payload: { ...event.payload, delivery: { smtpStatusCode: '550', smtpEnhancedStatusCode: '5.1.1', smtpResponse: '550 User unknown', deliveryTimeMs: 2143 }, bounce: { type: 'hard', classification: 'permanent_failure', reason: 'User unknown' } } };
  assert.deepEqual(parseDeliveryEvent(bounced).details, { smtp_status_code: '550', smtp_enhanced_status_code: '5.1.1', smtp_response: '550 User unknown', delivery_time_ms: 2143, bounce_type: 'hard', bounce_classification: 'permanent_failure', bounce_reason: 'User unknown' });
  const untrusted = { ...bounced, payload: { ...bounced.payload, delivery: { smtpResponse: 'x'.repeat(3000), deliveryTimeMs: -1 }, bounce: { type: { value: 'hard' } } } };
  assert.deepEqual(parseDeliveryEvent(untrusted).details, {});
});

test('preserves documented rejection and failure diagnostics', () => {
  const rejected = { ...event, type: 'cf.email.sending.message.rejected', payload: { ...event.payload, terminal: true, delivery: { status: 'rejected', provider: 'external_smtp' }, rejection: { reason: 'suppressed', party: 'recipient', detail: 'Recipient is suppressed' } } };
  assert.deepEqual(parseDeliveryEvent(rejected).details, { delivery_status: 'rejected', provider: 'external_smtp', rejection_reason: 'suppressed', rejection_party: 'recipient', rejection_detail: 'Recipient is suppressed', terminal: true });
  const failed = { ...event, type: 'cf.email.sending.message.failed', payload: { ...event.payload, terminal: true, failure: { reason: 'delivery_failed' } } };
  assert.deepEqual(parseDeliveryEvent(failed).details, { failure_reason: 'delivery_failed', terminal: true });
  const oversized = { ...failed, payload: { ...failed.payload, terminal: 'true', failure: { reason: 'x'.repeat(2049) } } };
  assert.deepEqual(parseDeliveryEvent(oversized).details, {});
  const oversizedStatus = { ...rejected, payload: { ...rejected.payload, delivery: { status: 'x'.repeat(2049) } } };
  assert.equal(parseDeliveryEvent(oversizedStatus).details.delivery_status, undefined);
});
