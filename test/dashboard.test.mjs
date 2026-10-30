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
