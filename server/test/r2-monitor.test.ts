import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Importing the monitor pulls in db.ts (which opens SQLite at import time) and
// mailer.ts; point the DB at a throwaway file like the other suites do. No
// network is touched here — only the pure evaluateUsage / classifyAction /
// monthRange helpers are exercised.
process.env.VRP_DB_PATH = join(tmpdir(), `vrp-r2mon-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const mon = await import('../src/services/r2UsageMonitor');

// Day 15 of a 31-day month -> elapsed fraction 15/31, so a cumulative value is
// projected to roughly 2.07x its month-to-date amount.
const MID_MAY = new Date('2026-05-15T00:00:00Z');

test('classifyAction maps R2 operation classes (unknown defaults to Class A)', () => {
  assert.equal(mon.classifyAction('PutObject'), 'A');
  assert.equal(mon.classifyAction('ListObjects'), 'A');
  assert.equal(mon.classifyAction('GetObject'), 'B');
  assert.equal(mon.classifyAction('HeadObject'), 'B');
  assert.equal(mon.classifyAction('DeleteObject'), 'free');
  assert.equal(mon.classifyAction('SomeFutureOperation'), 'A');
});

test('monthRange returns the current UTC calendar-month boundaries', () => {
  const { start, end } = mon.monthRange(MID_MAY);
  assert.equal(start, '2026-05-01T00:00:00.000Z');
  assert.equal(end, '2026-06-01T00:00:00.000Z');
});

test('low usage is ok with no projected overage', () => {
  const r = mon.evaluateUsage({ storageBytes: 1_000_000_000, classA: 100_000, classB: 1_000_000 }, MID_MAY);
  assert.equal(r.level, 'ok');
  assert.equal(r.projectedOverageUsd, 0);
});

test('storage at 85% triggers warn (point-in-time, not projected)', () => {
  const r = mon.evaluateUsage({ storageBytes: 8_500_000_000, classA: 0, classB: 0 }, MID_MAY);
  assert.equal(r.level, 'warn');
  assert.equal(r.projectedOverageUsd, 0);
});

test('Class A already over the free limit is critical with a dollar estimate', () => {
  const r = mon.evaluateUsage({ storageBytes: 0, classA: 2_000_000, classB: 0 }, MID_MAY);
  assert.equal(r.level, 'critical');
  const a = r.metrics.find((m) => m.name.startsWith('Class A'));
  assert.ok(a && a.used >= a.limit);
  assert.ok(r.projectedOverageUsd > 0);
});

test('Class A under the limit now but projected to exceed it is critical', () => {
  // 600k writes by day 15/31 -> projected ~1.24M > 1M free limit.
  const r = mon.evaluateUsage({ storageBytes: 0, classA: 600_000, classB: 0 }, MID_MAY);
  const a = r.metrics.find((m) => m.name.startsWith('Class A'));
  assert.ok(a && a.used < a.limit);
  assert.ok(a && a.projected > a.limit);
  assert.equal(r.level, 'critical');
});

test('early-month projection is suppressed so a day-1 burst does not false-alarm', () => {
  // On day 1 a naive linear projection would multiply usage by ~31x; 100k Class A
  // ops would project over the 1M limit. Projection-based alerts are suppressed
  // in the first days of the month, so this stays ok (actual usage is only 10%).
  const day1 = new Date('2026-05-01T00:00:00Z');
  const r = mon.evaluateUsage({ storageBytes: 0, classA: 100_000, classB: 0 }, day1);
  assert.equal(r.level, 'ok');
});

test('actual usage already over the limit alerts critical even on day 1', () => {
  const day1 = new Date('2026-05-01T00:00:00Z');
  const r = mon.evaluateUsage({ storageBytes: 0, classA: 1_500_000, classB: 0 }, day1);
  assert.equal(r.level, 'critical');
});

test('a metric exactly at its free limit is warn, not critical (no overage yet)', () => {
  const r = mon.evaluateUsage({ storageBytes: 10_000_000_000, classA: 0, classB: 0 }, MID_MAY);
  assert.equal(r.level, 'warn');
  assert.equal(r.projectedOverageUsd, 0);
});
