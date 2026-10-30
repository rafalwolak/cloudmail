import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTemplate } from '../src/templates.ts';

const published = JSON.stringify({ name: 'Welcome', html: '<p>{{{NAME}}}</p>', text: 'Hi {{{NAME}}}', variables: [{ key: 'NAME', type: 'string' }] });
const env = { DB: { prepare() { return { bind() { return { async first() { return { published }; } }; } }; } } };

test('template variables are escaped in HTML and remain plain text in text bodies', async () => {
  const result = await resolveTemplate({ template: { id: 'example', variables: { NAME: '<img src=x>' } } }, env);
  assert.equal(result.html, '<p>&lt;img src=x&gt;</p>');
  assert.equal(result.text, 'Hi <img src=x>');
});

test('missing, unknown and incompatible template inputs are rejected', async () => {
  assert.equal(typeof await resolveTemplate({ template: { id: 'example' } }, env), 'string');
  assert.equal(typeof await resolveTemplate({ template: { id: 'example', variables: { NAME: 'Jane', EXTRA: 'x' } } }, env), 'string');
  assert.equal(typeof await resolveTemplate({ html: '<p>Other</p>', template: { id: 'example', variables: { NAME: 'Jane' } } }, env), 'string');
});
