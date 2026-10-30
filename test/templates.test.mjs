import { test } from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_API_KEY || 'local-test-key';
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const call = (path, method, body) => fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

test('template drafts must be published before sending', async () => {
  const created = await call('/templates', 'POST', { name: 'Welcome', html: '<p>Hello {{{NAME}}}</p>', variables: [{ key: 'NAME', type: 'string' }] });
  assert.equal(created.status, 200, await created.clone().text());
  const { id } = await created.json();
  const message = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Welcome', template: { id, variables: { NAME: 'Jane' } } };
  assert.equal((await call('/emails', 'POST', message)).status, 400);
  assert.equal((await call(`/templates/${id}/publish`, 'POST')).status, 200);
  const sent = await call('/emails', 'POST', message);
  assert.equal(sent.status, 200, await sent.clone().text());
  assert.ok((await sent.json()).id);
  assert.equal((await call(`/templates/${id}`, 'DELETE')).status, 200);
});

test('template management requires authentication', async () => {
  assert.equal((await fetch(`${base}/templates`)).status, 401);
});

test('editing a draft does not change the published version until republished', async () => {
  const created = await call('/templates', 'POST', { name: 'Snapshot', html: '<p>Hi</p>', from: 'sender@example.com', subject: 'Published' });
  const { id } = await created.json();
  assert.equal((await call(`/templates/${id}/publish`, 'POST')).status, 200);
  assert.equal((await call(`/templates/${id}`, 'PATCH', { subject: 'Updated' })).status, 200);
  const send = async () => {
    const response = await call('/emails', 'POST', { to: 'recipient@example.com', template: { id } });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).id;
  };
  const first = await send();
  assert.equal((await (await call(`/emails/${first}`, 'GET')).json()).subject, 'Published');
  assert.equal((await call(`/templates/${id}/publish`, 'POST')).status, 200);
  const second = await send();
  assert.equal((await (await call(`/emails/${second}`, 'GET')).json()).subject, 'Updated');
  await call(`/templates/${id}`, 'DELETE');
});

test('published templates can be used in batch sends', async () => {
  const created = await call('/templates', 'POST', { name: 'Batch template', html: '<p>{{{NAME}}}</p>', from: 'sender@example.com', subject: 'Hello', variables: [{ key: 'NAME', type: 'string', fallback_value: 'friend' }] });
  const { id } = await created.json();
  assert.equal((await call(`/templates/${id}/publish`, 'POST')).status, 200);
  const response = await call('/emails/batch', 'POST', [
    { to: 'first@example.com', template: { id } },
    { to: 'second@example.com', template: { id, variables: { NAME: 'Jane' } } },
  ]);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).data.length, 2);
  await call(`/templates/${id}`, 'DELETE');
});

test('templates support cursor pagination and duplicate into an unpublished draft', async () => {
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const created = await call('/templates', 'POST', { name: `Pagination ${i}`, html: '<p>Hello</p>' });
    ids.push((await created.json()).id);
  }
  try {
    const first = await (await call('/templates?limit=2', 'GET')).json();
    assert.equal(first.data.length, 2);
    assert.equal(first.has_more, true);
    const secondResponse = await call(`/templates?limit=2&after=${first.data.at(-1).id}`, 'GET');
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.ok(second.data.every(item => !first.data.some(other => other.id === item.id)));
    const previous = await (await call(`/templates?limit=2&before=${second.data[0].id}`, 'GET')).json();
    assert.deepEqual(previous.data.map(item => item.id), first.data.map(item => item.id));
    assert.equal((await call('/templates?after=a&before=b', 'GET')).status, 400);
    assert.equal((await call('/templates?after=missing', 'GET')).status, 400);
    await call(`/templates/${ids[0]}/publish`, 'POST');
    const duplicate = await call(`/templates/${ids[0]}/duplicate`, 'POST');
    assert.equal(duplicate.status, 200);
    const copiedId = (await duplicate.json()).id;
    ids.push(copiedId);
    const copy = await (await call(`/templates/${copiedId}`, 'GET')).json();
    assert.equal(copy.status, 'draft');
    assert.equal(copy.html, '<p>Hello</p>');
  } finally { for (const id of ids) await call(`/templates/${id}`, 'DELETE'); }
});

test('published aliases resolve safely and change only after publication', async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const alias = `welcome-${suffix}`;
  const nextAlias = `new-${suffix}`;
  const first = await call('/templates', 'POST', { name: 'Alias one', alias, html: '<p>One</p>', from: 'sender@example.com', subject: 'One' });
  assert.equal(first.status, 200);
  const second = await call('/templates', 'POST', { name: 'Alias two', alias, html: '<p>Two</p>' });
  const ids = [(await first.json()).id, (await second.json()).id];
  const send = name => call('/emails', 'POST', { to: 'recipient@example.com', template: { id: name } });
  try {
    assert.equal((await send(alias)).status, 400);
    assert.equal((await call(`/templates/${ids[0]}/publish`, 'POST')).status, 200);
    assert.equal((await send(alias)).status, 200);
    assert.equal((await call(`/templates/${ids[1]}/publish`, 'POST')).status, 409);
    assert.equal((await call(`/templates/${ids[0]}`, 'PATCH', { alias: nextAlias })).status, 200);
    assert.equal((await send(alias)).status, 200);
    assert.equal((await send(nextAlias)).status, 400);
    assert.equal((await call(`/templates/${ids[0]}/publish`, 'POST')).status, 200);
    assert.equal((await send(alias)).status, 400);
    assert.equal((await send(nextAlias)).status, 200);
    assert.equal((await call(`/templates/${ids[1]}/publish`, 'POST')).status, 200);
  } finally { for (const id of ids) await call(`/templates/${id}`, 'DELETE'); }
});
