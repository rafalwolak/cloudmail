import { test } from 'node:test';
import assert from 'node:assert/strict';
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
