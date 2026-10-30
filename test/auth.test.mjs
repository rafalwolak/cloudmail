import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';

test('Better Auth returns an empty session to an anonymous visitor', async () => {
  const response = await fetch(`${base}/api/auth/get-session`);
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
});

test('registration is disabled until explicitly configured', { skip: process.env.TEST_SIGNUP === 'true' }, async () => {
  const response = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: 'correct horse battery staple' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'EMAIL_PASSWORD_SIGN_UP_DISABLED');
});

test('an unverified user cannot sign in after registration', { skip: process.env.TEST_SIGNUP !== 'true' }, async () => {
  const email = `test-${crypto.randomUUID()}@example.com`;
  const headers = { 'content-type': 'application/json', origin: base };
  const password = 'correct horse battery staple';
  const signup = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'Test', email, password }),
  });
  assert.equal(signup.status, 200, await signup.clone().text());
  const signin = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST', headers, body: JSON.stringify({ email, password }),
  });
  assert.equal(signin.status, 403, await signin.clone().text());
});
