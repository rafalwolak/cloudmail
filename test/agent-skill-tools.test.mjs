import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the Cloudmail agent skill references registered MCP tools', async () => {
  const skill = await readFile(new URL('../skills/cloudmail/SKILL.md', import.meta.url), 'utf8');
  const server = await readFile(new URL('../src/mcp.ts', import.meta.url), 'utf8');
  for (const name of ['list_webhook_events', 'get_webhook_event', 'list_webhook_event_attempts', 'replay_webhook_event', 'replay_webhook_delivery']) {
    assert.ok(skill.includes(`\`${name}\``), `${name} missing from skill`);
    assert.ok(server.includes(`registerTool('${name}'`), `${name} missing from server`);
  }
});
