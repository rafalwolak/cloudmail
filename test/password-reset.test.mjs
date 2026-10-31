import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureLocalAuthLink } from './local-auth-mail.mjs';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';

test('password reset revokes an existing session', { skip: process.env.TEST_PASSWORD_RESET !== 'true' }, async () => {
  const email = `reset-${crypto.randomUUID()}@example.com`;
  const password = 'correct horse battery staple';
  const headers = { origin: base, 'content-type': 'application/json' };
  const post = (path, body) => fetch(`${base}/api/auth/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const verificationLink = await captureLocalAuthLink(() => post('sign-up/email', { name: 'Reset test', email, password }), { base, pathname: '/api/auth/verify-email', email });
  assert.ok((await fetch(verificationLink)).ok);
  const signIn = await post('sign-in/email', { email, password });
  assert.equal(signIn.status, 200);
  const cookie = signIn.headers.get('set-cookie').split(';')[0];
  const resetLink = await captureLocalAuthLink(() => post('request-password-reset', { email, redirectTo: `${base}/dashboard` }), { base, pathname: '/api/auth/reset-password/' });
  const redirect = await fetch(resetLink, { redirect: 'manual' });
  const token = new URL(redirect.headers.get('location'), base).searchParams.get('token');
  assert.ok(token);
  assert.equal((await post('reset-password', { token, newPassword: 'another correct horse battery staple' })).status, 200);
  const oldSession = await fetch(`${base}/api/auth/get-session`, { headers: { cookie } });
  assert.equal((await oldSession.json()) === null, true, 'Password reset must invalidate the old session');
  assert.notEqual((await post('sign-in/email', { email, password })).status, 200);
  assert.equal((await post('sign-in/email', { email, password: 'another correct horse battery staple' })).status, 200);
});
