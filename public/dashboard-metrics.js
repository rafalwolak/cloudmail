export const metricLabels = {
  sent: 'Accepted messages', delivered: 'Delivered recipients', deferred: 'Deferred recipients',
  bounced: 'Bounced recipients', failed: 'Failed recipients', rejected: 'Rejected recipients', complained: 'Complaining recipients',
};

export function dailyMetricRows(report) {
  const first = new Date(report.start_date); first.setUTCHours(0, 0, 0, 0);
  const end = Date.parse(report.end_date);
  const periods = new Map(report.data.map(row => [row.period, row]));
  const rows = [];
  // The metrics API bounds the interval; missing buckets mean no recorded observations.
  for (let day = first.getTime(); day < end; day += 86400000) {
    const period = new Date(day).toISOString();
    const row = { period };
    for (const key of Object.keys(metricLabels)) row[key] = periods.get(period)?.[key] ?? 0;
    rows.push(row);
  }
  return rows;
}

export function metricPlot(rows, key) {
  const values = rows.map(row => row[key]);
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 500 : index * 1000 / (values.length - 1);
    const y = 228 - value / max * 216;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return { max, points };
}
