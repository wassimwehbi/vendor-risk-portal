import { db, nowIso } from '../db';
import { sendMail } from './mailer';

/**
 * Cloudflare R2 usage monitor (alert-only).
 *
 * Polls the Cloudflare GraphQL Analytics API for month-to-date R2 usage,
 * compares it against the free-tier allotments, and emails an alert (via the
 * existing SMTP setup) when usage approaches or crosses a limit. It never
 * changes R2 or pauses the app — Cloudflare has no hard spend cap, so this is
 * the budget guard for the free tier with overages enabled.
 *
 * Runs in-process inside the existing backend (the Node process is long-lived,
 * wrapped by Litestream), scheduled with setInterval. The whole monitor is
 * inert unless CLOUDFLARE_API_TOKEN + R2_ACCOUNT_ID are set.
 */

// R2 free-tier allotments per calendar month + overage rates.
// Cloudflare bills storage in GB-month and operations per million; 1 GB = 1e9 bytes.
const GB = 1_000_000_000;
const FREE = { storageGb: 10, classA: 1_000_000, classB: 10_000_000 } as const;
const RATE = { storagePerGbMonth: 0.015, classAPerMillion: 4.5, classBPerMillion: 0.36 } as const;

// R2 operation classes (https://developers.cloudflare.com/r2/pricing/).
// Reads are Class B; deletes/aborts are free; writes/lists/multipart are Class A.
// Unknown/new action types default to Class A so cost is never under-counted.
const CLASS_B_ACTIONS = new Set([
  'GetObject',
  'HeadObject',
  'HeadBucket',
  'UsageSummary',
  'GetBucketEncryption',
  'GetBucketLocation',
  'GetBucketCors',
  'GetBucketLifecycleConfiguration',
]);
const FREE_ACTIONS = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload']);

export type OpClass = 'A' | 'B' | 'free';
export function classifyAction(action: string): OpClass {
  if (CLASS_B_ACTIONS.has(action)) return 'B';
  if (FREE_ACTIONS.has(action)) return 'free';
  return 'A';
}

export interface R2Usage {
  storageBytes: number;
  classA: number;
  classB: number;
}

export type AlertLevel = 'ok' | 'warn' | 'critical';
const LEVEL_RANK: Record<AlertLevel, number> = { ok: 0, warn: 1, critical: 2 };

export interface MetricReport {
  name: string;
  unit: 'GB' | 'ops';
  used: number;
  limit: number;
  percent: number;
  projected: number;
  projectedPercent: number;
  overageUsd: number;
}

export interface UsageReport {
  level: AlertLevel;
  metrics: MetricReport[];
  projectedOverageUsd: number;
  summary: string;
}

function pct(used: number, limit: number): number {
  return limit > 0 ? (used / limit) * 100 : 0;
}

function bump(current: AlertLevel, next: AlertLevel): AlertLevel {
  return LEVEL_RANK[next] > LEVEL_RANK[current] ? next : current;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtN(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function opMetric(
  name: string,
  used: number,
  limit: number,
  ratePerMillion: number,
  project: (n: number) => number,
): MetricReport {
  const projected = project(used);
  return {
    name,
    unit: 'ops',
    used,
    limit,
    percent: pct(used, limit),
    projected,
    projectedPercent: pct(projected, limit),
    overageUsd: (Math.max(0, projected - limit) / 1_000_000) * ratePerMillion,
  };
}

/**
 * Pure evaluation: raw usage -> per-metric report + overall alert level.
 * Operations are cumulative month-to-date and are linearly projected to month
 * end; storage is point-in-time and is not projected. `warn` fires at
 * `warnPercent` of any limit; `critical` once any metric is already over its
 * limit or is projected to exceed it.
 */
export function evaluateUsage(usage: R2Usage, now: Date = new Date(), warnPercent = 80): UsageReport {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const elapsedFraction = Math.max(dayOfMonth / daysInMonth, 1 / daysInMonth);
  const project = (used: number) => used / elapsedFraction;

  const storageGb = usage.storageBytes / GB;
  const storage: MetricReport = {
    name: 'Storage',
    unit: 'GB',
    used: storageGb,
    limit: FREE.storageGb,
    percent: pct(storageGb, FREE.storageGb),
    projected: storageGb, // point-in-time, not projected
    projectedPercent: pct(storageGb, FREE.storageGb),
    overageUsd: Math.max(0, storageGb - FREE.storageGb) * RATE.storagePerGbMonth,
  };

  const metrics: MetricReport[] = [
    storage,
    opMetric('Class A ops (writes/lists)', usage.classA, FREE.classA, RATE.classAPerMillion, project),
    opMetric('Class B ops (reads)', usage.classB, FREE.classB, RATE.classBPerMillion, project),
  ];

  let level: AlertLevel = 'ok';
  for (const m of metrics) {
    if (m.used >= m.limit || m.projected >= m.limit) level = bump(level, 'critical');
    else if (m.percent >= warnPercent || m.projectedPercent >= warnPercent) level = bump(level, 'warn');
  }

  const projectedOverageUsd = round2(metrics.reduce((sum, m) => sum + m.overageUsd, 0));
  return { level, metrics, projectedOverageUsd, summary: formatSummary(level, metrics, projectedOverageUsd, now) };
}

function formatSummary(level: AlertLevel, metrics: MetricReport[], overageUsd: number, now: Date): string {
  const lines = metrics.map((m) => {
    if (m.unit === 'GB') {
      return `• ${m.name}: ${m.used.toFixed(2)} / ${m.limit} GB (${m.percent.toFixed(0)}%)`;
    }
    return `• ${m.name}: ${fmtN(m.used)} / ${fmtN(m.limit)} ops (${m.percent.toFixed(0)}%, projected ${fmtN(m.projected)} ≈ ${m.projectedPercent.toFixed(0)}% of limit)`;
  });
  return [
    `R2 usage level: ${level.toUpperCase()} (as of ${now.toISOString()})`,
    ...lines,
    `Estimated month-end overage: $${overageUsd.toFixed(2)}`,
  ].join('\n');
}

// ---- Cloudflare GraphQL Analytics ------------------------------------------

const GQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

const QUERY = `query R2Usage($tag: String!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $tag }) {
      storage: r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_lt: $end }, orderBy: [datetime_DESC]) {
        max { payloadSize metadataSize objectCount }
      }
      ops: r2OperationsAdaptiveGroups(limit: 200, filter: { datetime_geq: $start, datetime_lt: $end }) {
        dimensions { actionType }
        sum { requests }
      }
    }
  }
}`;

/** Inclusive start / exclusive end ISO timestamps for the current UTC calendar month. */
export function monthRange(now: Date = new Date()): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)).toISOString(),
    end: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
  };
}

/**
 * Queries account-wide R2 usage for the current month. Free-tier allotments and
 * overages are billed at the account level, so this intentionally does not
 * filter by bucket. Returns null (and logs) when unconfigured or on any error,
 * so a transient failure never crashes the server.
 */
export async function fetchR2Usage(now: Date = new Date()): Promise<R2Usage | null> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const tag = process.env.R2_ACCOUNT_ID;
  if (!token || !tag) {
    console.warn('[r2-monitor] CLOUDFLARE_API_TOKEN or R2_ACCOUNT_ID not set — skipping check');
    return null;
  }
  const { start, end } = monthRange(now);
  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { tag, start, end } }),
    });
    if (!res.ok) {
      console.error(`[r2-monitor] analytics request failed: HTTP ${res.status}`);
      return null;
    }
    const json: any = await res.json();
    if (json.errors?.length) {
      console.error(`[r2-monitor] GraphQL errors: ${JSON.stringify(json.errors)}`);
      return null;
    }
    const acct = json.data?.viewer?.accounts?.[0];
    if (!acct) {
      console.error('[r2-monitor] no account data returned (check token scope: Account Analytics:Read)');
      return null;
    }
    const storage = acct.storage?.[0]?.max ?? {};
    const storageBytes = (storage.payloadSize ?? 0) + (storage.metadataSize ?? 0);
    let classA = 0;
    let classB = 0;
    for (const group of acct.ops ?? []) {
      const action: string = group.dimensions?.actionType ?? '';
      const requests: number = group.sum?.requests ?? 0;
      const cls = classifyAction(action);
      if (cls === 'A') classA += requests;
      else if (cls === 'B') classB += requests;
    }
    return { storageBytes, classA, classB };
  } catch (err) {
    console.error(`[r2-monitor] analytics request error: ${(err as Error).message}`);
    return null;
  }
}

// ---- Alert dedup state (survives restarts; DB is replicated) ----------------

interface AlertState {
  month: string;
  level: AlertLevel;
}

function currentMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function readState(): AlertState | null {
  const row = db.prepare(`SELECT value FROM monitor_state WHERE key = 'r2_last_alert'`).get() as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as AlertState;
  } catch {
    return null;
  }
}

function writeState(state: AlertState): void {
  db.prepare(
    `INSERT INTO monitor_state (key, value, updated_at) VALUES ('r2_last_alert', @value, @updated_at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run({ value: JSON.stringify(state), updated_at: nowIso() });
}

// ---- Alert dispatch + scheduling -------------------------------------------

async function sendAlert(report: UsageReport): Promise<void> {
  const to = process.env.R2_ALERT_EMAIL || (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim();
  if (!to) {
    console.warn('[r2-monitor] no alert recipient configured (set R2_ALERT_EMAIL or ADMIN_EMAILS)');
    return;
  }
  const bucket = process.env.R2_MONITOR_BUCKET || 'vrp-litestream';
  const subject = `[R2 ${report.level.toUpperCase()}] Cloudflare R2 usage alert — vendor-risk-portal`;
  const intro =
    report.level === 'critical'
      ? 'R2 usage has crossed a free-tier limit (or is projected to this month) — overage charges are likely.'
      : 'R2 usage is approaching the free-tier limit. No charges yet, but worth a look.';
  const advice =
    'Cloudflare has no hard spend cap. To reduce usage: prune old Litestream snapshots, lengthen the replication interval, or add R2 lifecycle rules.';
  const text = `${intro}\n\nReplica bucket: ${bucket}\n\n${report.summary}\n\n${advice}\n\nAutomated alert from the vendor-risk-portal backend.`;
  const html =
    `<p>${intro}</p>` +
    `<p><strong>Replica bucket:</strong> ${bucket}</p>` +
    `<pre style="font:13px/1.5 ui-monospace,monospace">${report.summary.replace(/</g, '&lt;')}</pre>` +
    `<p>${advice}</p>`;
  await sendMail({ to, subject, text, html });
  console.log(`[r2-monitor] ${report.level} alert sent to ${to}`);
}

/** One check cycle: fetch -> evaluate -> alert if the level escalated this month. Exposed for manual/test runs. */
export async function runR2UsageCheck(now: Date = new Date()): Promise<UsageReport | null> {
  const usage = await fetchR2Usage(now);
  if (!usage) return null;
  const warnPercent = Number(process.env.R2_ALERT_WARN_PERCENT) || 80;
  const report = evaluateUsage(usage, now, warnPercent);
  console.log(`[r2-monitor] ${report.summary.replace(/\n/g, ' | ')}`);

  const month = currentMonth(now);
  const prev = readState();
  const prevLevel: AlertLevel = prev && prev.month === month ? prev.level : 'ok';
  // Alert only when escalating beyond the highest level already alerted this
  // month — avoids re-sending on every interval and across restarts.
  if (LEVEL_RANK[report.level] > LEVEL_RANK[prevLevel]) {
    await sendAlert(report);
    writeState({ month, level: report.level });
  }
  return report;
}

/**
 * Starts the in-process monitor. Inert (logs and returns) unless enabled and
 * configured. Timers are unref'd so they never keep the process alive on their
 * own. Call once after the server starts listening.
 */
export function startR2UsageMonitor(): void {
  const enabled = (process.env.R2_MONITOR_ENABLED || 'true') !== 'false';
  if (!enabled) {
    console.log('[r2-monitor] disabled (R2_MONITOR_ENABLED=false)');
    return;
  }
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.R2_ACCOUNT_ID) {
    console.log('[r2-monitor] not configured — set CLOUDFLARE_API_TOKEN + R2_ACCOUNT_ID to enable');
    return;
  }
  const intervalHours = Number(process.env.R2_MONITOR_INTERVAL_HOURS) || 12;
  console.log(`[r2-monitor] enabled — checking R2 usage every ${intervalHours}h`);
  // First check shortly after boot (don't block startup), then on the interval.
  setTimeout(() => void runR2UsageCheck(), 10_000).unref();
  setInterval(() => void runR2UsageCheck(), intervalHours * 60 * 60 * 1000).unref();
}
