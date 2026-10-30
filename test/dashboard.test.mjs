import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
test('dashboard exposes a labelled sign-in form and loads its script', async () => {
  const response = await fetch(`${base}/dashboard`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<label[^>]+for="email"/);
  assert.match(html, /<label[^>]+for="password"/);
  assert.match(html, /src="\/dashboard\.js"/);
  assert.equal((await fetch(`${base}/dashboard.js`)).status, 200);
});

test('dashboard provides registration and password recovery forms', async () => {
  const response = await fetch(`${base}/dashboard`);
  const html = await response.text();
  assert.match(html, /id="signup-form"/);
  assert.match(html, /id="forgot-form"/);
  assert.match(html, /id="reset-form"/);
});

test('dashboard email history requires a session', async () => {
  assert.equal((await fetch(`${base}/api/history`)).status, 401);
  assert.equal((await fetch(`${base}/api/history/metrics`)).status, 401);
  assert.equal((await fetch(`${base}/api/history/00000000-0000-0000-0000-000000000000`)).status, 401);
  const html = await (await fetch(`${base}/dashboard`)).text();
  assert.match(html, /id="history-list"/);
  assert.match(html, /id="metrics-form"/);
  assert.match(html, /id="metrics-status" role="status"/);
});

test('dashboard send requires an administrator and trusted origin', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const path = `${base}/api/send`;
  const message = { from: 'sender@example.com', to: ['recipient@example.com', 'second@example.com'], cc: ['copy@example.com'], bcc: ['private@example.com'], reply_to: 'reply@example.com', subject: 'Dashboard send', html: '<p>Local test</p>', attachments: [{ filename: 'test.txt', content: 'aGVsbG8=', content_type: 'text/plain' }] };
  const data = JSON.stringify(message);
  assert.equal((await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: data })).status, 401);
  const auth = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, origin: base, 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
  assert.equal((await fetch(path, { method: 'POST', headers: { ...headers, origin: 'https://attacker.example' }, body: data })).status, 403);
  const first = await fetch(path, { method: 'POST', headers, body: data });
  assert.equal(first.status, 200);
  const second = await fetch(path, { method: 'POST', headers, body: data });
  const accepted = await first.json();
  assert.deepEqual(accepted, await second.json());
  const details = await (await fetch(`${base}/api/history/${accepted.id}`, { headers: { cookie } })).json();
  assert.deepEqual(details.cc, message.cc);
  assert.deepEqual(details.bcc, message.bcc);
  assert.equal(details.reply_to, message.reply_to);
  const scheduledAt = new Date(Date.now() + 120000).toISOString();
  const scheduled = await fetch(path, { method: 'POST', headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ ...message, scheduled_at: scheduledAt }) });
  assert.equal(scheduled.status, 200);
  const scheduledId = (await scheduled.json()).id;
  const scheduledDetails = await (await fetch(`${base}/api/history/${scheduledId}`, { headers: { cookie } })).json();
  assert.equal(scheduledDetails.status, 'scheduled');
  assert.equal(scheduledDetails.scheduled_at, scheduledAt);
  assert.equal((await fetch(`${base}/api/history/${scheduledId}/cancel`, { method: 'POST', headers: { cookie, origin: base } })).status, 200);
});

test('verified administrator can read history with a session', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const history = await fetch(`${base}/api/history?limit=2`, { headers: { cookie } });
  assert.equal(history.status, 200);
  assert.equal(history.headers.get('cache-control'), 'no-store');
  const metrics = await fetch(`${base}/api/history/metrics`, { headers: { cookie } });
  assert.equal(metrics.status, 200);
  assert.equal(typeof (await metrics.json()).totals.sent, 'number');
  const data = (await history.json()).data;
  assert.equal(data.length, 2);
  const detail = await fetch(`${base}/api/history/${data[0].id}`, { headers: { cookie } });
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray((await detail.json()).delivery_events));
});

test('dashboard template management requires a session', async () => {
  assert.equal((await fetch(`${base}/api/templates`)).status, 401);
});

test('administrator can create and publish a template from dashboard API', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const response = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, origin: base, 'content-type': 'application/json' };
  const create = await fetch(`${base}/api/templates`, { method: 'POST', headers, body: JSON.stringify({ name: 'Dashboard test', html: '<p>Hello</p>' }) });
  assert.equal(create.status, 200);
  const { id } = await create.json();
  const badOrigin = await fetch(`${base}/api/templates/${id}/publish`, { method: 'POST', headers: { ...headers, origin: 'https://attacker.example' } });
  assert.equal(badOrigin.status, 403);
  const publish = await fetch(`${base}/api/templates/${id}/publish`, { method: 'POST', headers });
  assert.equal(publish.status, 200);
  const detail = await fetch(`${base}/api/templates/${id}`, { headers });
  assert.equal((await detail.json()).status, 'published');
  assert.equal((await fetch(`${base}/api/templates/${id}`, { method: 'DELETE', headers })).status, 200);
});

test('dashboard schedule changes require an administrator and a trusted origin', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  const auth = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const scheduled_at = new Date(Date.now() + 60000).toISOString();
  const created = await fetch(`${base}/emails`, { method: 'POST', headers: { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'sender@example.com', to: 'recipient@example.com', subject: 'Dashboard schedule', text: 'Hi', scheduled_at }) });
  assert.equal(created.status, 200);
  const { id } = await created.json();
  const path = `${base}/api/history/${id}`;
  const later = new Date(Date.now() + 120000).toISOString();
  assert.equal((await fetch(path, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ scheduled_at: later }) })).status, 401);
  assert.equal((await fetch(path, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json', origin: 'https://attacker.example' }, body: JSON.stringify({ scheduled_at: later }) })).status, 403);
  assert.equal((await fetch(path, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json', origin: base }, body: JSON.stringify({ scheduled_at: later }) })).status, 200);
  assert.equal((await (await fetch(path, { headers: { cookie } })).json()).scheduled_at, later);
  assert.equal((await fetch(`${path}/cancel`, { method: 'POST', headers: { cookie, origin: base } })).status, 200);
});

test('dashboard inbox requires an administrator session', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  assert.equal((await fetch(`${base}/api/inbox`)).status, 401);
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const list = await fetch(`${base}/api/inbox?limit=1`, { headers: { cookie } });
  assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.ok(Array.isArray((await list.json()).data));
  assert.equal((await fetch(`${base}/api/inbox/missing`, { headers: { cookie } })).status, 404);
  const path = `${base}/api/inbox/00000000-0000-0000-0000-000000000000`;
  assert.equal((await fetch(path, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(path, { method: 'DELETE', headers: { cookie, origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(path, { method: 'DELETE', headers: { cookie, origin: base } })).status, 404);
});

test('dashboard webhooks require an administrator and reject cross-origin changes', { skip: !process.env.TEST_DASHBOARD_ADMIN }, async () => {
  assert.equal((await fetch(`${base}/api/webhooks`)).status, 401);
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: process.env.TEST_DASHBOARD_ADMIN, password: process.env.TEST_DASHBOARD_PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const request = { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'https://attacker.example' }, body: JSON.stringify({ endpoint: 'https://hooks.example.com', events: ['email.delivered'] }) };
  assert.equal((await fetch(`${base}/api/webhooks`, request)).status, 403);
  request.headers.origin = base;
  const created = await fetch(`${base}/api/webhooks`, request); assert.equal(created.status, 201);
  const { id, signing_secret } = await created.json(); assert.match(signing_secret, /^whsec_/);
  const list = await (await fetch(`${base}/api/webhooks`, { headers: { cookie } })).json();
  assert.ok(list.data.some(item => item.id === id)); assert.ok(!JSON.stringify(list).includes(signing_secret));
  assert.equal((await fetch(`${base}/api/webhooks/${id}/deliveries`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/webhooks/${id}/deliveries/${'0'.repeat(32)}/replay`, { method: 'POST', headers: { cookie, origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/webhooks/${id}`, { method: 'DELETE', headers: { cookie, origin: base } })).status, 200);
});

test('Cloudflare integration endpoints require an administrator session', async () => {
  for (const [path, method] of [
    ['/api/cloudflare/oauth/start', 'POST'],
    ['/api/cloudflare/oauth/callback?state=invalid&code=invalid', 'GET'],
    ['/api/cloudflare/zones', 'GET'],
    ['/api/cloudflare/zones', 'POST'],
    [`/api/cloudflare/zones/${'a'.repeat(32)}/domains`, 'GET'],
    [`/api/cloudflare/zones/${'a'.repeat(32)}/suppressions`, 'GET'],
    [`/api/cloudflare/zones/${'a'.repeat(32)}/suppressions`, 'POST'],
    [`/api/cloudflare/zones/${'a'.repeat(32)}/suppressions/12345678-1234-4234-8234-123456789abc`, 'DELETE'],
  ]) {
    const response = await fetch(`${base}${path}`, { method, headers: { origin: base, 'content-type': 'application/json' }, ...(method === 'POST' && { body: '{}' }) });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});
