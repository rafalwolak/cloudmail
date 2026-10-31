import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyMetricRows, metricPlot } from '../public/dashboard-metrics.js';

test('daily metrics fill missing UTC buckets and preserve independent totals', () => {
  const report = { start_date: '2031-01-01T12:00:00Z', end_date: '2031-01-04T00:00:00Z', totals: { delivered: 1 }, data: [{ period: '2031-01-01T00:00:00.000Z', sent: 3, delivered: 1 }, { period: '2031-01-03T00:00:00.000Z', sent: 0, delivered: 1 }] };
  const rows = dailyMetricRows(report);
  assert.deepEqual(rows.map(row => [row.period, row.sent, row.delivered]), [
    ['2031-01-01T00:00:00.000Z', 3, 1], ['2031-01-02T00:00:00.000Z', 0, 0], ['2031-01-03T00:00:00.000Z', 0, 1],
  ]);
  assert.equal(report.totals.delivered, 1);
  assert.equal(rows[1].bounced, 0);
});

test('empty and ninety-day metrics stay bounded and produce finite chart coordinates', () => {
  const rows = dailyMetricRows({ start_date: '2031-01-01T00:00:00Z', end_date: '2031-04-01T00:00:00Z', data: [] });
  assert.equal(rows.length, 90);
  const plot = metricPlot(rows, 'sent');
  assert.equal(plot.max, 1);
  const points = plot.points.split(' ').map(point => point.split(',').map(Number));
  assert.equal(points.length, 90);
  assert.ok(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && y === 228));
  assert.equal(points[0][0], 0);
  assert.equal(points.at(-1)[0], 1000);
});

test('each selected metric has its own scale and handles a single observed day', () => {
  const rows = [{ sent: 100, delivered: 2 }];
  assert.deepEqual(metricPlot(rows, 'delivered'), { max: 2, points: '500.00,12.00' });
  assert.equal(metricPlot(rows, 'sent').max, 100);
});
