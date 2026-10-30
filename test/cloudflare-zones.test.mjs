import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCloudflareZones } from '../src/cloudflare-zones.ts';

test('lists one page of authorized zones without leaking unrelated upstream fields', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.origin + url.pathname, 'https://api.cloudflare.com/client/v4/zones');
    assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('per_page'), '50');
    assert.equal(options.headers.authorization, 'Bearer private-token'); assert.equal(options.redirect, 'manual');
    return Response.json({ success: true, result: [{ id: 'a'.repeat(32), name: 'example.com', status: 'active', account: { id: 'account', name: 'Example' }, verification_key: 'sensitive' }], result_info: { page: 2, total_pages: 3 } });
  };
  try {
    const result = await listCloudflareZones('private-token', 2);
    assert.deepEqual(result, { data: [{ id: 'a'.repeat(32), name: 'example.com', status: 'active', account: { id: 'account', name: 'Example' } }], page: 2, totalPages: 3 });
  } finally { globalThis.fetch = original; }
});

test('rejects invalid pagination and hides Cloudflare error details', async () => {
  const original = globalThis.fetch;
  try {
    await assert.rejects(listCloudflareZones('token', 0));
    globalThis.fetch = async () => Response.json({ errors: [{ message: 'private-token' }] }, { status: 403 });
    await assert.rejects(listCloudflareZones('private-token', 1), error => !error.message.includes('private-token'));
    globalThis.fetch = async () => Response.json({ success: true, result: [], result_info: { page: 2, total_pages: 3 } });
    await assert.rejects(listCloudflareZones('token', 1));
  } finally { globalThis.fetch = original; }
});
