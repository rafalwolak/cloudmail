import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const headers = { authorization: `Bearer ${process.env.TEST_API_KEY || 'local-test-key'}`, 'content-type': 'application/json' };
const message = { from: 'sender@example.test', to: 'recipient@example.test', subject: 'HTML', html: '<p>Hello &amp; welcome</p><p><a href="https://example.test">Read more</a></p>' };

test('HTML-only single and batch sends retain generated text and explicit empty text opts out', async () => {
  const send = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const single = await send('/emails', message); assert.equal(single.status, 200, await single.clone().text());
  const singleDetail = await (await fetch(`${base}/emails/${(await single.json()).id}`, { headers })).json();
  assert.match(singleDetail.text, /Hello & welcome/); assert.match(singleDetail.text, /https:\/\/example.test/);
  const batch = await send('/emails/batch', [message, { ...message, text: '' }]); assert.equal(batch.status, 200, await batch.clone().text());
  const ids = (await batch.json()).data.map(item => item.id);
  const first = await (await fetch(`${base}/emails/${ids[0]}`, { headers })).json();
  const second = await (await fetch(`${base}/emails/${ids[1]}`, { headers })).json();
  assert.match(first.text, /Hello & welcome/); assert.equal(second.text, '');
});

test('scheduled HTML-only messages retain generated text after their attempt', async () => {
  const created = await fetch(`${base}/emails`, { method: 'POST', headers, body: JSON.stringify({ ...message, scheduled_at: 'in 1 second' }) });
  assert.equal(created.status, 200); const { id } = await created.json();
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal((await fetch(`${base}/cdn-cgi/local/scheduled`)).status, 200);
  const detail = await (await fetch(`${base}/emails/${id}`, { headers })).json();
  assert.equal(detail.status, 'accepted'); assert.match(detail.text, /Hello & welcome/);
});
