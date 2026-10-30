import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('deployment template does not bind the original account database or URL', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.notEqual(config.d1_databases[0].database_id, '5325bf9f-b6da-438d-9119-e24ca1fbd07b');
  assert.notEqual(config.vars.BETTER_AUTH_URL, 'https://cloudmail.design4pro.workers.dev');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts.deploy, /migrations apply DB --remote/);
});

test('deployment advertises a secret without a shared default and keeps signup disabled', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const example = await readFile(new URL('../.dev.vars.example', import.meta.url), 'utf8');
  assert.match(example, /^BETTER_AUTH_SECRET=$/m);
  assert.equal(config.vars.ENABLE_SIGNUP, 'false');
  for (const binding of ['BETTER_AUTH_SECRET', 'ENABLE_SIGNUP', 'DB', 'INBOUND']) assert.ok(packageJson.cloudflare.bindings[binding].description);
});
