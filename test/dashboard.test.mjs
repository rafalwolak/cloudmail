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
  const html = await (await fetch(`${base}/dashboard`)).text();
  assert.match(html, /id="history-list"/);
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
  assert.equal((await history.json()).data.length, 2);
});
