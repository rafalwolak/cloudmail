import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';

test('API key management requires a user session', async () => {
  const response = await fetch(`${base}/api/keys`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'test' }) });
  assert.equal(response.status, 401);
});

test('verified admin can create, use and revoke a key', { skip: process.env.TEST_KEYS !== 'true' }, async () => {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const email = process.env.TEST_ADMIN_EMAIL;
  const password = 'a sufficiently long test password';
  const headers = { origin: base, 'content-type': 'application/json' };
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST', headers, body: JSON.stringify({ name: 'Admin', email, password }) });
  assert.equal(signup.status, 200, await signup.clone().text());
  async function files(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]))).flat();
  }
  const candidates = (await files('.wrangler/tmp/email')).filter(path => path.includes('/email-text/'));
  const timestamps = await Promise.all(candidates.map(async path => ({ path, time: (await stat(path)).mtimeMs })));
  timestamps.sort((a, b) => b.time - a.time);
  const text = await readFile(timestamps[0].path, 'utf8');
  const url = text.match(/http:\/\/127\.0\.0\.1:8787\/api\/auth\/verify-email\?[^\s]+/)?.[0];
  assert.ok(url, 'verification link is present in the simulated email');
  const verification = await fetch(url, { redirect: 'manual' });
  assert.ok([200, 302].includes(verification.status));
  const signin = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
  assert.equal(signin.status, 200, await signin.clone().text());
  const cookie = signin.headers.get('set-cookie').split(';')[0];
  const authHeaders = { ...headers, cookie };
  const create = await fetch(`${base}/api/keys`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'test' }) });
  assert.equal(create.status, 201, await create.clone().text());
  assert.equal(create.headers.get('cache-control'), 'no-store');
  const { id, token } = await create.json();
  const list = await fetch(`${base}/api/keys`, { headers: { cookie } });
  const listBody = await list.json();
  assert.equal(listBody.data[0].id, id);
  assert.ok(!JSON.stringify(listBody).includes(token));
  const send = () => fetch(`${base}/emails`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'a@example.com', to: 'b@example.com', subject: 'Hi', text: 'Hi' }) });
  assert.equal((await send()).status, 200);
  const csrf = await fetch(`${base}/api/keys/${id}`, { method: 'DELETE', headers: { cookie, origin: 'https://attacker.example' } });
  assert.equal(csrf.status, 403);
  const revoke = await fetch(`${base}/api/keys/${id}`, { method: 'DELETE', headers: { cookie, origin: base } });
  assert.equal(revoke.status, 204);
  assert.equal((await send()).status, 401);
});
