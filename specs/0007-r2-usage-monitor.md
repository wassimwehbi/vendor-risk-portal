# Spec 0007 — Cloudflare R2 Usage Monitor (free-tier overage alerts)

- **Status:** Implemented (2026-05-26)
- **Branch:** `claude/r2-usage-monitor-patch-XyOnA`
- **Location:** `vendor-risk-portal/` — `server/src/services/r2UsageMonitor.ts` (new), `server/test/r2-monitor.test.ts` (new), `server/src/services/mailer.ts` (extracted generic `sendMail`), `server/src/db.ts` (new `monitor_state` table), `server/src/index.ts` (start the monitor after `listen`), `server/scripts/r2-usage-report.ts` (new live-check CLI), `server/test/r2-monitor.live.ts` (new opt-in live integration test), `.env.example` (documented config).
- **Related docs:** `specs/0004-free-demo-deployment.md` (Litestream ⇄ R2 backup), `specs/0002-enterprise-readiness.md` (WS-5 Deployment & Ops), `README.md` (Deployment section).
- **Builds on:** Spec 0004 — the demo tier replicates SQLite to Cloudflare R2 via Litestream. R2 has overages enabled and **no hard spend cap**, so we need a budget guard.

## 1. Problem Statement & Objective

Spec 0004 backs the SQLite database up to Cloudflare R2 with Litestream. R2's free
tier covers 10 GB-month of storage, 1M Class A ops, and 10M Class B ops; beyond that
Cloudflare bills overages and offers **no hard spend cap**. A runaway replication
interval, snapshot accumulation, or misconfiguration could silently incur charges.

Objective: a lightweight, **alert-only** budget guard that warns by email as R2 usage
approaches or crosses the free-tier limits, with zero standing cost and no new
infrastructure. It must never change R2 or pause the app — the human stays in control
of any remediation.

## 2. Approach & Changes

- **In-process monitor** (`r2UsageMonitor.ts`) started from `index.ts` after the server
  begins listening. Scheduled with `setTimeout` (first check ~10s after boot, so startup
  isn't blocked) + `setInterval` (default every 12h). Both timers are `unref()`'d so they
  never keep the process alive on their own. The Node process is long-lived (wrapped by
  Litestream), so an in-process scheduler is sufficient — no cron/worker needed.
- **Data source:** Cloudflare GraphQL Analytics API (`r2StorageAdaptiveGroups` +
  `r2OperationsAdaptiveGroups`), queried account-wide for the current UTC calendar month.
  Free-tier allotments are billed at the account level, so the query intentionally does
  not filter by bucket.
- **Evaluation** (`evaluateUsage`, pure/testable): operations are cumulative month-to-date
  and linearly projected to month-end; storage is point-in-time (not projected). Levels:
  `warn` at ≥80% of any limit (configurable), `critical` once any metric is already over
  or projected to exceed its limit. `critical` uses a strict over-limit comparison
  (`used > limit`), since overage is billed only strictly above the free allotment — a
  metric sitting exactly at its limit is `warn`, not `critical`. Projection-based alerts
  are suppressed for the first `MIN_PROJECTION_DAYS` (3) days of the month, where a single
  day's usage would extrapolate to ~30× and false-alarm — projection is trusted only once
  that many *full* days have elapsed (day 4+, via `elapsedDays = dayOfMonth - 1`); actual
  usage already over a limit still alerts immediately. Also estimates the month-end overage
  in USD.
- **Operation classification** (`classifyAction`): reads → Class B, deletes/aborts → free,
  everything else (writes/lists/multipart, and any unknown/new action) → Class A, so cost
  is never under-counted.
- **Alerting:** reuses the existing SMTP setup via a new generic `sendMail` extracted from
  `mailer.ts` (the magic-link and invite flows now call it too). Recipient defaults to the
  first `ADMIN_EMAILS` entry.
- **De-duplication:** a new `monitor_state` key/value table stores the highest alert level
  already sent for the current month, so an alert fires only on **escalation** — not on
  every interval, and not again after a restart. The level is persisted only **after** an
  email is actually dispatched, so a missing recipient or unconfigured SMTP can't
  permanently suppress the real alert for the rest of the month. State rides along in the
  Litestream-replicated DB.
- **Validated env config:** numeric env vars — the warn percent (`R2_ALERT_WARN_PERCENT`,
  required to be 0–100) and check interval (`R2_MONITOR_INTERVAL_HOURS`, required > 0) — are
  validated (finite and in range) and fall back to their defaults (80% / 12h) otherwise, so a
  malformed or out-of-range value can't disable the guard or set a nonsensical schedule.
- **Inert by default:** the whole monitor logs and returns unless `R2_MONITOR_ENABLED` is
  not `false` **and** both `CLOUDFLARE_API_TOKEN` and `R2_ACCOUNT_ID` are set. Local/offline
  dev is unaffected; when SMTP is unconfigured `sendMail` logs instead of sending.

## 3. Key Decisions & Rationale

- **Alert-only, never mutate.** Cloudflare has no spend cap and the project's principle is
  that a human makes the call. Auto-pausing replication could risk data durability, so we
  only notify.
- **Account-wide, not per-bucket.** Billing and free allotments are account-level; the
  configured `R2_MONITOR_BUCKET` is shown in the email purely for context.
- **Project operations, but not storage.** Ops accrue over the month and a linear
  projection gives early warning; storage is a current snapshot, so projecting it would be
  misleading.
- **Unknown action types → Class A.** Fail toward over-counting cost so a new R2 action
  type never causes us to silently under-report.
- **Reuse SMTP + DB, add no infra.** Keeps the $0 demo-tier promise from Spec 0004.

## 4. Verification

- `npm --prefix server run typecheck` — passes.
- `npm --prefix server test` — 69/69 pass, including 10 cases in `r2-monitor.test.ts`
  covering `classifyAction`, `monthRange`, an OK baseline, an 85%-storage `warn`, a
  Class-A-over-limit `critical` (with a positive USD estimate), a Class-A
  under-now-but-projected-over `critical`, early-month projection suppression, an
  actual-over-limit `critical` on day 1, a metric exactly at its limit being `warn`
  (not `critical`), and the day-3/day-4 `MIN_PROJECTION_DAYS` boundary. Tests exercise
  the pure helpers only — no network or SMTP is touched.
- **Live validation (opt-in, against real assets).** Two tools exercise the integration
  path the unit suite cannot, both reading credentials from the project-root `.env`:
  - `npm --prefix server run test:live` — an integration test (`test/r2-monitor.live.ts`,
    excluded from the default `test/*.test.ts` glob so CI stays offline) that hits the real
    Cloudflare R2 Analytics API and asserts the response parses into a well-formed report.
    It **self-skips** with a clear message unless `CLOUDFLARE_API_TOKEN` + `R2_ACCOUNT_ID`
    are set.
  - `npm --prefix server run r2:check` — a CLI (`scripts/r2-usage-report.ts`) that prints
    the live month-to-date usage, the computed level, and the projected overage. Add
    `-- --send-test-alert` to also send the alert email, validating the SMTP path end to
    end. Read-only against Cloudflare; only emails when the flag is passed.
- **Live-validated 2026-05-26 (with a fix).** Running `test:live` against the real account
  surfaced a GraphQL bug the network-free unit tests could not: the storage sub-query used
  `orderBy: [datetime_DESC]` without selecting `datetime` as a dimension, which Cloudflare
  rejects (`cannot order by datetime: it is neither aggregated, nor a dimension`). Fixed by
  adding `dimensions { datetime }` to the `r2StorageAdaptiveGroups` selection in `QUERY`; the
  live test then returned a well-formed `OK` report (storage 0 GB, Class A/B ops far under
  the free tier). See `specs/0009-test-credential-management.md` for how the credentials are
  supplied.

## 5. Known Limitations / Follow-ups

- **No UI surface.** Usage is only emailed / logged; a future admin dashboard panel could
  show current month-to-date usage and level.
- **Account-scoped numbers.** If the account hosts other R2 buckets beyond this app, the
  reported usage includes them (which is correct for the billing guard, but not a
  per-app figure).
- **Cloudflare analytics lag/availability.** The Analytics API can lag real time and
  occasionally error; the monitor returns `null` and logs on any failure rather than
  crashing, and retries on the next interval.
- **Overage rates are hard-coded** from R2 pricing at implementation time; if Cloudflare
  changes pricing the USD estimate would need updating (alert levels themselves depend
  only on the free-tier limits).
- **Per-month alerting is monotonic** — within a calendar month an alert fires only when
  the level escalates beyond the highest already-sent level. A metric that drops below a
  threshold and later re-crosses it the same month is not re-alerted (intentional, to avoid
  alert spam).
