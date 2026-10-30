import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the default delivery queue matches the configured consumer', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.queues.consumers.length, 1);
  assert.equal(config.queues.consumers[0].queue, config.vars.DELIVERY_QUEUE_NAME);
});
