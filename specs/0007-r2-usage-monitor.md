# Spec 0007 — Cloudflare R2 Usage Monitor (free-tier overage alerts)

- **Status:** Implemented (2026-05-26)
- **Branch:** `claude/r2-usage-monitor-patch-XyOnA`
- **Location:** `vendor-risk-portal/` — `server/src/services/r2UsageMonitor.ts` (new), `server/test/r2-monitor.test.ts` (new), `server/src/services/mailer.ts` (extracted generic `sendMail`), `server/src/db.ts` (new `monitor_state` table), `server/src/index.ts` (start the monitor after `listen`), `.env.example` (documented config).
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
  or projected to exceed its limit. Also estimates the month-end overage in USD.
- **Operation classification** (`classifyAction`): reads → Class B, deletes/aborts → free,
  everything else (writes/lists/multipart, and any unknown/new action) → Class A, so cost
  is never under-counted.
- **Alerting:** reuses the existing SMTP setup via a new generic `sendMail` extracted from
  `mailer.ts` (the magic-link and invite flows now call it too). Recipient defaults to the
  first `ADMIN_EMAILS` entry.
- **De-duplication:** a new `monitor_state` key/value table stores the highest alert level
  already sent for the current month, so an alert fires only on **escalation** — not on
  every interval, and not again after a restart. State rides along in the Litestream-
  replicated DB.
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
- `npm --prefix server test` — 65/65 pass, including 6 new cases in `r2-monitor.test.ts`
  covering `classifyAction`, `monthRange`, an OK baseline, an 85%-storage `warn`, a
  Class-A-over-limit `critical` (with a positive USD estimate), and a Class-A
  under-now-but-projected-over `critical`. Tests exercise the pure helpers only — no
  network or SMTP is touched.

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
