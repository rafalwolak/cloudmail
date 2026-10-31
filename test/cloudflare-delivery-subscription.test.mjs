import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeliverySubscription, inspectDeliverySubscription, ensureDeliverySubscription, CloudflareQueueAccessError } from '../src/cloudflare-delivery-subscription.ts';

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

test('creation serializes requests and retains the lock for an uncertain result', async () => {
  const queue = 'a'.repeat(32); const zone = 'b'.repeat(32); const account = 'c'.repeat(32); let lock = null; let created = null; let fail = false; let denied = 0; let posts = 0;
  const db = { prepare(sql) { return { bind(...args) { return {
    async first() { if (!sql.startsWith('INSERT INTO delivery_subscription_locks')) throw new Error('Unexpected SQL'); if (lock) return null; lock = { target: args[0], owner: args[1] }; return { owner: lock.owner }; },
    async run() { if (lock?.target === args[0] && lock.owner === args[1]) lock = null; },
  }; } }; } };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (options.method === 'POST') { posts++; if (denied) return new Response(null, { status: denied }); if (fail) throw new Error('network failure'); created = { id: 'created', ...JSON.parse(options.body) }; return Response.json({ success: true, result: created }); }
    const result = url.pathname.endsWith('/queues') ? [{ queue_name: 'delivery', queue_id: queue }] : created ? [created] : [];
    return Response.json({ success: true, result, result_info: { page: 1, total_pages: 1, total_count: result.length } });
  };
  try {
    assert.deepEqual(await ensureDeliverySubscription(db, 'secret', account, 'delivery', zone, 'mail.example.com'), { action: 'created', id: 'created' });
    assert.equal(lock, null);
    assert.deepEqual(await ensureDeliverySubscription(db, 'secret', account, 'delivery', zone, 'mail.example.com'), { action: 'ready', id: 'created' });
    assert.equal(posts, 1);
    created = null;
    for (const status of [401, 403]) {
      denied = status;
      await assert.rejects(ensureDeliverySubscription(db, 'secret', account, 'delivery', zone, 'mail.example.com'), CloudflareQueueAccessError);
      assert.equal(lock, null);
    }
    denied = 0;
    created = null; fail = true;
    await assert.rejects(ensureDeliverySubscription(db, 'secret', account, 'delivery', zone, 'mail.example.com'), /network failure/);
    assert.ok(lock);
    await assert.rejects(ensureDeliverySubscription(db, 'secret', account, 'delivery', zone, 'mail.example.com'), /already in progress/);
    assert.equal(posts, 4);
  } finally { globalThis.fetch = original; }
});

test('inspection checks every Cloudflare subscription page and rejects incomplete results', async () => {
  const queue = 'a'.repeat(32); const zone = 'b'.repeat(32); const account = 'c'.repeat(32);
  const target = planDeliverySubscription([], queue, zone, 'mail.example.com').request;
  const other = { id: 'other', ...target, source: { ...target.source, domain: 'other.example.com' } };
  const existing = { id: 'existing', ...target }; let incomplete = false; const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input); calls.push(url); assert.equal(options.headers.authorization, 'Bearer secret');
    if (url.pathname.endsWith('/queues')) return Response.json({ success: true, result: [{ queue_name: 'delivery-events', queue_id: queue }], result_info: { page: 1, total_pages: 1, total_count: 1 } });
    const page = Number(url.searchParams.get('page'));
    return Response.json({ success: true, result: page === 1 ? [other] : [existing], result_info: { page, total_pages: 2, total_count: incomplete && page === 2 ? 3 : 2 } });
  };
  try {
    assert.deepEqual(await inspectDeliverySubscription('secret', account, 'delivery-events', zone, 'mail.example.com'), { action: 'ready', id: 'existing' });
    assert.equal(calls.length, 3); assert.equal(calls[2].searchParams.get('queue_id'), queue);
    incomplete = true;
    await assert.rejects(inspectDeliverySubscription('secret', account, 'delivery-events', zone, 'mail.example.com'), /changed during pagination/);
  } finally { globalThis.fetch = original; }
});
