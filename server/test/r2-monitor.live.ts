// Load the project-root .env first (like scripts/r2-usage-report.ts) so a filled
// .env supplies CLOUDFLARE_API_TOKEN + R2_ACCOUNT_ID for the skip check below.
// dotenv no-ops when .env is absent and never overrides already-set vars, so CI's
// job-level env still wins and the test stays a clean skip when no creds exist.
import '../src/env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Opt-in live integration test against the real Cloudflare R2 Analytics API.
// It is NOT part of the default suite: the `npm test` glob is `test/*.test.ts`,
// so this `*.live.ts` file only runs via `npm run test:live`. It also self-skips
// unless real credentials are present, so running it without creds is a no-op.
//
//   CLOUDFLARE_API_TOKEN=… R2_ACCOUNT_ID=… npm --prefix server run test:live
//
// Importing the monitor opens SQLite at import time; point it at a throwaway DB
// like the other suites. The skip reason is shown in the runner output.
process.env.VRP_DB_PATH = join(tmpdir(), `vrp-r2live-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const skip =
  process.env.CLOUDFLARE_API_TOKEN && process.env.R2_ACCOUNT_ID
    ? false
    : 'set CLOUDFLARE_API_TOKEN + R2_ACCOUNT_ID to run the live R2 check';

const mon = await import('../src/services/r2UsageMonitor');

test('live: fetchR2Usage returns parseable account usage', { skip }, async () => {
  const usage = await mon.fetchR2Usage();
  assert.ok(usage, 'expected non-null usage — check token scope (Account Analytics: Read) and R2_ACCOUNT_ID');
  for (const key of ['storageBytes', 'classA', 'classB'] as const) {
    assert.equal(typeof usage[key], 'number', `${key} should be a number`);
    assert.ok(Number.isFinite(usage[key]) && usage[key] >= 0, `${key} should be a non-negative finite number`);
  }
});

test('live: evaluateUsage produces a well-formed report from live usage', { skip }, async () => {
  const usage = await mon.fetchR2Usage();
  assert.ok(usage, 'expected non-null usage');
  const report = mon.evaluateUsage(usage);
  assert.ok(['ok', 'warn', 'critical'].includes(report.level), 'level must be ok | warn | critical');
  assert.equal(report.metrics.length, 3, 'expected storage + Class A + Class B metrics');
  assert.ok(Number.isFinite(report.projectedOverageUsd) && report.projectedOverageUsd >= 0);
  // Surface the real numbers for the operator running the check.
  console.log(`\n${report.summary}\n`);
});
