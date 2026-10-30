import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manageDomains } from '../src/domains.ts';

const zone = 'a'.repeat(32); const tag = 'b'.repeat(32);
const env = { zoneId: zone, accessToken: 'private-token' };
const request = (path, method = 'GET', body) => new Request(`https://cloudmail.example${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test('domain API requires authentication and reports missing configuration', async () => {
  const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
  for (const [path, method] of [['/domains', 'GET'], ['/domains', 'POST'], [`/domains/${tag}`, 'GET'], [`/domains/${tag}`, 'DELETE']]) {
    assert.equal((await fetch(`${base}${path}`, { method })).status, 401, `${method} ${path}`);
  }
  const response = await fetch(`${base}/domains`, { headers: { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}` } });
  assert.equal(response.status, 503);
});

test('domain management calls only the configured Cloudflare zone and preserves result', async () => {
  const calls = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ success: true, result: options.method === 'GET' && url.endsWith('/subdomains') ? [{ tag, name: 'example.com', enabled: true }] : { tag, name: 'example.com', enabled: true }, result_info: { page: 1, total_pages: 3 } }); };
  try {
    const list = await manageDomains(request('/domains'), env);
    assert.equal(list.status, 200); const listBody = await list.json(); assert.equal(listBody.data[0].tag, tag); assert.equal(listBody.result_info.total_pages, 3);
    const created = await manageDomains(request('/domains', 'POST', { name: 'Mail.Example.com' }), env);
    assert.equal(created.status, 201); assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'mail.example.com' });
    assert.equal((await manageDomains(request(`/domains/${tag}`), env)).status, 200);
    const dns = await manageDomains(request(`/domains/${tag}/dns`), env); assert.equal(dns.status, 200); assert.equal((await dns.json()).result_info.total_pages, 3);
    assert.deepEqual(await (await manageDomains(request(`/domains/${tag}`, 'DELETE'), env)).json(), { id: tag, deleted: true });
    assert.ok(calls.every(call => call.url.startsWith(`https://api.cloudflare.com/client/v4/zones/${zone}/email/sending/subdomains`) && call.options.redirect === 'manual'));
    assert.ok(calls.every(call => call.options.headers.authorization === 'Bearer private-token'));
  } finally { globalThis.fetch = original; }
});

test('domain management rejects bad input and hides upstream secrets', async () => {
  assert.equal((await manageDomains(request('/domains'), null)).status, 503);
  assert.equal((await manageDomains(request('/domains/../../secrets'), env)).status, 404);
  assert.equal((await manageDomains(request('/domains?limit=1'), env)).status, 400);
  assert.equal((await manageDomains(request('/domains', 'POST', { name: 'https://example.com' }), env)).status, 400);
  assert.equal((await manageDomains(request('/domains', 'POST', { name: 'example.com', extra: true }), env)).status, 400);
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false, errors: [{ message: 'private-token' }] }, { status: 403 });
  try { const result = await manageDomains(request('/domains'), env); assert.equal(result.status, 502); assert.ok(!(await result.text()).includes('private-token')); }
  finally { globalThis.fetch = original; }
});


test('domain list rejects a malformed upstream success response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, result: [{ name: 'example.com', enabled: 'yes' }] });
  try {
    assert.equal((await manageDomains(request('/domains'), env)).status, 502);
    globalThis.fetch = async () => Response.json({ success: true, result: [{ name: 'example.com', enabled: true, tag: 'invalid' }] });
    assert.equal((await manageDomains(request('/domains'), env)).status, 502);
  }
  finally { globalThis.fetch = original; }
});
