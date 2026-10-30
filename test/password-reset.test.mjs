import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
async function latestMailLink(pattern) {
  async function files(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]))).flat();
  }
  const paths = (await files('.wrangler/tmp/email')).filter(path => path.includes('/email-text/'));
  const ordered = await Promise.all(paths.map(async path => ({ path, mtime: (await stat(path)).mtimeMs })));
  ordered.sort((a, b) => b.mtime - a.mtime);
  const content = await readFile(ordered[0].path, 'utf8');
  const link = content.match(pattern)?.[0];
  assert.ok(link, 'simulated email contains the expected link');
  return link;
}

test('password reset revokes an existing session', { skip: process.env.TEST_PASSWORD_RESET !== 'true' }, async () => {
  const email = `reset-${crypto.randomUUID()}@example.com`;
  const password = 'correct horse battery staple';
  const headers = { origin: base, 'content-type': 'application/json' };
  const post = (path, body) => fetch(`${base}/api/auth/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post('sign-up/email', { name: 'Reset test', email, password })).status, 200);
  const verificationLink = await latestMailLink(/http:\/\/127\.0\.0\.1:8787\/api\/auth\/verify-email\?[^\s]+/);
  assert.ok((await fetch(verificationLink)).ok);
  const signIn = await post('sign-in/email', { email, password });
  assert.equal(signIn.status, 200);
  const cookie = signIn.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('request-password-reset', { email, redirectTo: `${base}/dashboard` })).status, 200);
  const resetLink = await latestMailLink(/http:\/\/127\.0\.0\.1:8787\/api\/auth\/reset-password\/[^\s]+/);
  const redirect = await fetch(resetLink, { redirect: 'manual' });
  const token = new URL(redirect.headers.get('location'), base).searchParams.get('token');
  assert.ok(token);
  assert.equal((await post('reset-password', { token, newPassword: 'another correct horse battery staple' })).status, 200);
  const oldSession = await fetch(`${base}/api/auth/get-session`, { headers: { cookie } });
  assert.equal(await oldSession.json(), null);
  assert.notEqual((await post('sign-in/email', { email, password })).status, 200);
  assert.equal((await post('sign-in/email', { email, password: 'another correct horse battery staple' })).status, 200);
});
