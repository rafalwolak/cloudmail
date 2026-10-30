import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeliverySubscription } from '../src/cloudflare-delivery-subscription.ts';

test('delivery subscription planning reuses complete subscriptions and refuses ambiguous or incomplete ones', () => {
  const queue = 'a'.repeat(32); const zone = 'b'.repeat(32);
  const create = planDeliverySubscription([], queue, zone, 'MAIL.Example.com');
  assert.equal(create.action, 'create'); assert.equal(create.request.source.domain, 'mail.example.com'); assert.equal(create.request.events.length, 6);
  const existing = { id: 'existing', ...create.request };
  assert.deepEqual(planDeliverySubscription([existing], queue, zone, 'MAIL.example.com'), { action: 'ready', id: 'existing' });
  assert.deepEqual(planDeliverySubscription([{ ...existing, enabled: false }], queue, zone, 'mail.example.com'), { action: 'conflict', ids: ['existing'] });
  assert.deepEqual(planDeliverySubscription([{ ...existing, events: ['message.delivered'] }], queue, zone, 'mail.example.com'), { action: 'conflict', ids: ['existing'] });
  assert.equal(planDeliverySubscription([existing, { ...existing, id: 'duplicate' }], queue, zone, 'mail.example.com').action, 'conflict');
  assert.equal(planDeliverySubscription([{ ...existing, source: { ...existing.source, domain: 'other.example.com' } }], queue, zone, 'mail.example.com').action, 'create');
  assert.throws(() => planDeliverySubscription([], queue, zone, 'bad/path'));
});
