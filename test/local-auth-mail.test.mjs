import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localTestOrigin, localAuthLink, captureLocalAuthLink } from './local-auth-mail.mjs';

const base = 'http://127.0.0.1:8787';
const token = email => `header.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.signature`;
const verification = email => `${base}/api/auth/verify-email?token=${token(email)}`;

test('authentication fixtures reject remote, credentialed and non-origin targets before running actions', async () => {
  for (const value of ['https://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', `${base}/dashboard`, `${base}?query=1`]) {
    assert.throws(() => localTestOrigin(value));
    let called = false;
    await assert.rejects(captureLocalAuthLink(() => { called = true; }, { base: value, pathname: '/api/auth/verify-email' }));
    assert.equal(called, false);
  }
});

test('verification capture matches recipient and origin instead of following the newest arbitrary link', () => {
  const text = `https://evil.test/api/auth/verify-email?token=x ${verification('other@example.com')} ${verification('admin@example.com')}`;
  assert.equal(localAuthLink(text, base, '/api/auth/verify-email', 'admin@example.com').href, verification('admin@example.com'));
  assert.equal(localAuthLink(text, base, '/api/auth/verify-email', 'missing@example.com'), null);
  assert.equal(localAuthLink(`${base}/api/auth/verify-email?token=invalid`, base, '/api/auth/verify-email', 'admin@example.com'), null);
  assert.equal(localAuthLink(`${base}/api/auth/reset-password/opaque`, base, '/api/auth/verify-email'), null);
});

test('local mail capture ignores old files and waits for the requested newly saved text email', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloudmail-mail-fixture-'));
  try {
    await mkdir(join(directory, 'email-text'));
    await writeFile(join(directory, 'email-text/old.txt'), verification('admin@example.com'));
    const result = await captureLocalAuthLink(async () => {
      await writeFile(join(directory, 'email-text/new.txt'), verification('admin@example.com'));
      return new Response(null, { status: 200 });
    }, { base, pathname: '/api/auth/verify-email', email: 'admin@example.com', directory });
    assert.equal(result.href, verification('admin@example.com'));
  } finally { await rm(directory, { recursive: true }); }
});
