import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentForAgent } from '../src/agent-attachment.ts';

test('agent attachment limit applies even without a content-length header', async () => {
  const result = await attachmentForAgent(new Response(new Uint8Array(1024 * 1024 + 1)));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /size limit/);
});
