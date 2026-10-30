import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookHeaders, validWebhookUrl } from '../src/webhooks.ts';

test('webhook endpoints require safe HTTPS URLs', () => {
  assert.equal(validWebhookUrl('https://hooks.example.com/events'), true);
  for (const value of ['http://hooks.example.com', 'https://localhost/a', 'https://127.0.0.1/a', 'https://user:pass@example.com', 'https://[::1]/', 'https://hooks.example.com/#fragment']) assert.equal(validWebhookUrl(value), false);
});
test('webhook signatures bind identifier, timestamp and exact payload', async () => {
  const secret = 'whsec_' + btoa('01234567890123456789012345678901');
  const body = '{"type":"email.delivered"}';
  const headers = await webhookHeaders(secret, 'event_123', 1700000000, body);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('01234567890123456789012345678901'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`event_123.1700000000.${body}`));
  assert.equal(headers['svix-id'], 'event_123');
  assert.equal(headers['svix-timestamp'], '1700000000');
  assert.equal(headers['svix-signature'], `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`);
  const dual = await webhookHeaders(secret, 'event_123', 1700000000, body, secret);
  assert.equal(dual['svix-signature'], `${headers['svix-signature']} ${headers['svix-signature']}`);
});

test('dispatch signs events and records success or schedules a retry', async () => {
  const { processWebhooks } = await import('../src/webhooks.ts');
  const secret = 'whsec_' + btoa('01234567890123456789012345678901');
  for (const status of [204, 503]) {
    const operations = []; const posts = [];
    const env = { DB: { prepare(sql) { return { bind(...args) { return {
      async all() { return { results: [{ id: 'delivery1' }] }; },
      async first() {
        if (sql.includes('RETURNING attempts')) return { attempts: 1 };
        if (sql.includes('JOIN webhooks')) return { id: 'delivery1', attempts: 1, endpoint: 'https://hooks.example.com/event', signing_secret: secret, previous_secret: secret, previous_secret_expires_at: new Date(Date.now() + 3600000).toISOString(), event_id: 'event1', type: 'delivered', recipient: 'user@example.com', occurred_at: '2026-10-30T10:00:00.000Z', details: '{}', provider_id: 'provider1' };
        if (sql.includes('FROM email_history')) return { id: 'email1', sender: 'sender@example.com', subject: 'Hello', tags: '[]' };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async run() { if (!sql.startsWith('UPDATE webhooks SET previous_secret')) operations.push({ sql, args }); },
    }; } }; } } };
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => { posts.push({ url, options }); return new Response(null, { status }); };
    try { await processWebhooks(env); } finally { globalThis.fetch = original; }
    assert.equal(posts.length, 1); assert.equal(posts[0].options.redirect, 'manual');
    assert.equal(posts[0].options.headers['svix-id'], 'evt_delivery1');
    assert.equal(posts[0].options.headers['svix-signature'].split(' ').length, 2);
    assert.equal(JSON.parse(posts[0].options.body).data.email_id, 'email1');
    assert.match(operations[0].sql, status === 204 ? /state = 'delivered'/ : /UPDATE webhook_deliveries SET state = \?/);
    if (status === 503) assert.equal(operations[0].args[0], 'pending');
  }
});
