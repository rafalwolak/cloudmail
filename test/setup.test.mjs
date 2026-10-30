import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticationConfigured } from '../src/auth-config.ts';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';

test('setup status reports configuration without disclosing secrets or addresses', async () => {
  const response = await fetch(`${base}/api/setup`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(typeof data.authentication_configured, 'boolean');
  assert.equal(typeof data.registration_enabled, 'boolean');
  assert.equal(typeof data.sender_configured, 'boolean');
  assert.equal(typeof data.administrator_configured, 'boolean');
  assert.equal(data.sending_domain_status, 'unknown');
  assert.ok(!JSON.stringify(data).includes('@'));
});

test('authentication rejects example, weak and unsafe configuration', () => {
  const valid = { BETTER_AUTH_SECRET: 'a'.repeat(64), BETTER_AUTH_URL: 'https://mail.example.net' };
  assert.equal(authenticationConfigured(valid), true);
  assert.equal(authenticationConfigured({ ...valid, BETTER_AUTH_SECRET: 'replace-with-a-unique-random-secret' }), false);
  assert.equal(authenticationConfigured({ ...valid, BETTER_AUTH_SECRET: 'short' }), false);
  assert.equal(authenticationConfigured({ ...valid, BETTER_AUTH_URL: 'https://example.com' }), false);
  assert.equal(authenticationConfigured({ ...valid, BETTER_AUTH_URL: 'http://example.net' }), false);
  assert.equal(authenticationConfigured({ ...valid, BETTER_AUTH_URL: 'https://mail.example.net/path' }), false);
  assert.equal(authenticationConfigured({ ...valid, BETTER_AUTH_URL: 'http://127.0.0.1:8787' }), true);
});
