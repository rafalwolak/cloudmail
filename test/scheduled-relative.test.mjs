import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/scheduled.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { validateSchedule } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const now = Date.parse('2026-10-30T12:00:00Z');

test('relative schedules resolve from the request time with bounded duration', () => {
  assert.equal(validateSchedule('in 1 min', now), '2026-10-30T12:01:00.000Z');
  assert.equal(validateSchedule('in 2 hours', now), '2026-10-30T14:00:00.000Z');
  assert.equal(validateSchedule('in 30 days', now), '2026-11-29T12:00:00.000Z');
  for (const value of ['in 0 min', 'in 31 days', 'in 1 month', 'in -1 min', 'tomorrow']) assert.equal(validateSchedule(value, now), null);
});
