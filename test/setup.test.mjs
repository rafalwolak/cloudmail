import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticationConfigured, authenticationOriginMatches, configuredMailbox } from '../src/auth-config.ts';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';

test('setup status reports configuration without disclosing secrets or addresses', async () => {
  const response = await fetch(`${base}/api/setup`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(typeof data.authentication_configured, 'boolean');
  assert.equal(typeof data.authentication_origin_matches, 'boolean');
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

test('setup only considers plausible mailbox addresses configured', () => {
  for (const value of ['', ' ', 'not-an-email', 'a@', 'a@example', 'Name <a@example.com>', 'a@example.com\n']) assert.equal(configuredMailbox(value), false);
  for (const value of ['admin@example.com', 'user+test@sub.example.net']) assert.equal(configuredMailbox(value), true);
});

test('setup detects an authentication URL that points to a different origin', () => {
  assert.equal(authenticationOriginMatches('https://mail.example.com', 'https://mail.example.com'), true);
  assert.equal(authenticationOriginMatches('https://mail.example.com', 'https://other.example.com'), false);
  assert.equal(authenticationOriginMatches('http://localhost:8787', 'http://localhost:8792'), false);
  assert.equal(authenticationOriginMatches('invalid', 'https://mail.example.com'), false);
});
