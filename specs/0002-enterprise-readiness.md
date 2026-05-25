# Spec 0002 — Enterprise Readiness Hardening

- **Status:** Proposed (not started)
- **Branch:** `claude/vendor-risk-questionnaire-portal-nAj7f`
- **Location:** `vendor-risk-portal/`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md`, `README.md`, `API_CONTRACT.md`
- **Builds on:** Spec 0001 (Implemented v1)

## 1. Problem Statement & Objectives

Spec 0001 delivered a working analyst tool. It is suitable today for an internal team,
small data volumes, and a single node. To deploy it as an enterprise-grade service we
must close gaps in **operational maturity** (CI/CD, observability, tests), **security &
compliance** (vulnerable dependencies, audit immutability), **scale** (pagination,
concurrency, evidence storage), and **deployment** (containers, runbooks, migrations).

Objective: make the portal safe to run in production for a regulated, multi-user
context without changing its core product behavior or the "AI is preliminary, human
decides" principle from Spec 0001.

Non-goals for this spec: changing the analysis model, the risk-scoring math, or the
UX flows. This is hardening, not new product surface.

## 2. Open Decisions (resolve before / during implementation)

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | **Data layer** — SQLite is single-threaded/single-node | (a) Keep SQLite + add backup/restore + migration system; (b) Abstract the store behind an interface so SQLite/Postgres both work; (c) Full PostgreSQL migration | **(b) Pluggable** — unblocks multi-node later without a big-bang rewrite now. Choose (c) only if concurrent-user load is already known to exceed SQLite. |
| D2 | **Internationalization** | (a) Defer (English-only); (b) Add `react-i18next` scaffolding + externalize strings | **(a) Defer** unless a multi-language requirement exists; it is a large, separable effort. |
| D3 | **Hosting target** (shapes Docker/health/secrets) | Plain Docker/Compose, Kubernetes, or a PaaS | **Docker + Compose** as the portable baseline; add k8s manifests only if that is the target. |

These are documented so work can proceed; D1 in particular gates Workstream 4.

## 3. Workstreams

Each workstream below lists current state, target, concrete changes, primary files,
and acceptance criteria. Effort is rough (S/M/L). Workstreams are ordered roughly by
value-to-effort.

### WS-1 — Quality Gates & CI/CD  *(Effort: M)*

**Current:** No CI; nothing runs on push. No ESLint/Prettier/editorconfig. Tests are
server-only (`server/test/*.test.ts`, node:test) — no client tests, no API/HTTP-level
integration tests, no coverage reporting.

**Target:** Every push/PR runs typecheck + lint + tests + build + dependency audit.
Consistent formatting enforced. Client and HTTP layers covered by tests.

**Changes:**
- Add `.github/workflows/ci.yml`: matrix-free Node 22 job running `npm run typecheck`,
  `npm run lint`, `npm test` (server), client tests, `npm run build`, and
  `npm audit --omit=dev` (non-blocking report initially).
- Add ESLint (typescript-eslint) + Prettier configs at repo root and/or per package;
  add `lint`/`format` scripts to root `package.json`.
- Add a pre-commit hook (husky + lint-staged) for format + lint on staged files.
- Add **client tests** with Vitest + React Testing Library (start with
  `AuthContext`, `api/client.ts` CSRF/401 handling, `FindingRow` override UI,
  `RiskBadge`/`StatusChip`).
- Add **API integration tests** (supertest against the Express app) covering the
  happy paths in `API_CONTRACT.md`: session/CSRF, create→upload→analyze→patch→approve,
  Viewer-403 gating, export.
- Add coverage reporting (`c8`/Vitest coverage) with a starting threshold gate.

**Primary files:** `.github/workflows/ci.yml`, root + `client/` + `server/`
`package.json`, new `.eslintrc.*`/`eslint.config.js`, `.prettierrc`, `.editorconfig`,
`client/vitest.config.ts`, new `client/src/**/*.test.tsx`, new
`server/test/api.*.test.ts`.

**Acceptance:** CI is green on a PR; a deliberately broken test/lint/type fails CI;
client + API integration tests run in CI; coverage report produced.

### WS-2 — Observability & Resilience  *(Effort: M)*

**Current:** `console.log` only; no structured logs, request IDs, metrics, or error
tracking. No global Express error handler. No React error boundary (uncaught render
error → blank screen). `/api/health` reports AI availability but does not probe the DB.
Claude calls have no timeout/retry/backoff.

**Target:** Structured, correlated logs; failures captured and queryable; graceful
degradation around external calls; meaningful health/readiness.

**Changes:**
- Add **Pino** structured logging + request-logging middleware with a per-request
  correlation id (`x-request-id`), wired into `server/src/index.ts` ahead of routes.
- Add a **global Express error handler** (last middleware) that logs with the request
  id and returns the existing `{ success:false, error }` envelope without leaking
  internals.
- Add a **React error boundary** wrapping the router in `client/src/main.tsx`/`App.tsx`
  with a friendly fallback.
- Enrich `GET /api/health` to probe the DB (`SELECT 1`) and report `db: ok|fail`;
  optionally add `/api/ready` vs `/api/health` (liveness vs readiness).
- Add **timeout + bounded retry/backoff** around `claudeProvider.ts` calls and a
  simple circuit-breaker / fast-fail so a Claude outage degrades to the rule engine
  cleanly (the per-item fallback already exists in `aiEngine.ts`).
- Add an optional, env-gated **error-tracking hook** (e.g., Sentry DSN) — no-op when
  unset.

**Primary files:** `server/src/index.ts`, new `server/src/middleware/logging.ts` +
`server/src/middleware/errorHandler.ts`, `server/src/services/claudeProvider.ts`,
`server/src/routes/*` (health), `client/src/main.tsx`, new
`client/src/components/ErrorBoundary.tsx`.

**Acceptance:** logs are JSON with request ids correlating a request across lines; a
thrown route error is logged and returns a clean 500 envelope; killing the network to
Claude degrades to rule engine without 5xx; `/api/health` returns `db` status; React
error boundary renders fallback instead of blank page.

### WS-3 — Security & Compliance  *(Effort: M)*

**Current:** Strong base (passwordless SSO, CSRF, Helmet, CORS lockdown, rate limits,
parameterized SQL — see Spec 0001 §13). Gaps: vulnerable parse dependencies; mutable
audit log; no SECURITY.md / automated dependency updates; data/uploads unencrypted at
rest; upload validation present but no scan hook.

**Target:** No high-severity advisories in shipped deps; tamper-evident audit trail;
documented disclosure + automated dependency hygiene; upload pipeline ready for
malware scanning.

**Changes:**
- **Dependency remediation:** replace `xlsx` (prototype pollution + ReDoS, *no fix
  upstream*) with `exceljs` in `extraction.ts`, `evidenceExtraction.ts`, and
  `exporter.ts`; `npm audit fix` for `image-size` (DoS) and `mammoth` (path traversal);
  re-run the extraction/export tests to confirm parity.
- **Audit immutability:** enforce append-only on `audit_log` (no UPDATE/DELETE in
  `store.ts`; optional SQLite trigger to reject updates/deletes; document retention).
- Add **SECURITY.md** (disclosure policy) and **Dependabot/Renovate** config.
- Add a **scan hook point** in the upload pipeline (`routes/upload.ts`) so a scanner
  (e.g., ClamAV) can be enabled by config; quarantine on positive.
- Tighten audit read access if required (Viewers currently see actor emails) — confirm
  against policy; gate if needed in `routes/audit.ts`.
- Document **encryption-at-rest** options for the DB file + `uploads/` (FS/volume
  encryption) in the deployment guide; flag SQLCipher if D1 stays SQLite.

**Primary files:** `server/src/services/{extraction,evidenceExtraction,exporter}.ts`,
both `package.json`, `server/src/services/store.ts` + `db.ts` (audit constraints),
`server/src/routes/{upload,audit}.ts`, new `SECURITY.md`,
`.github/dependabot.yml`, existing `server/test/{extraction,evidenceExtraction}.test.ts`.

**Acceptance:** `npm audit` shows no high-severity in prod deps; extraction/export
tests pass on `exceljs`; attempts to UPDATE/DELETE `audit_log` are rejected/blocked;
SECURITY.md + Dependabot present; upload scan hook invoked (mockable) before
persistence.

### WS-4 — Scale & Performance  *(Effort: M–L; gated by D1)*

**Current:** No pagination — `listAssessments()`, audit, and finding reads do full
scans (`server/src/services/store.ts`). SQLite serializes writes (~10 concurrent-user
practical wall). Evidence files on local FS (`server/uploads/`) won't survive a
load-balanced/multi-node deploy. No query caching; no backup/restore.

**Target:** List endpoints paginate; data layer is swappable (per D1); evidence
storage is abstracted so cloud object storage can back it; backup/restore documented.

**Changes:**
- Add **pagination** (`limit`/`offset` or cursor) to `GET /api/assessments`,
  `GET /api/assessments/:id/audit`, and large finding/item reads; update
  `API_CONTRACT.md` and the client list/table fetches.
- Introduce a **storage interface** for evidence (`put/get/delete`) with a local-FS
  implementation today and an S3/GCS implementation behind config (`upload.ts`,
  `evidenceExtraction.ts`, `EvidencePanel` download path).
- Per **D1**, abstract the data store (or migrate to Postgres). If staying SQLite:
  add a documented **backup/restore** procedure (WAL checkpoint + file copy /
  `VACUUM INTO`) and a **migration runner** to replace ad-hoc `ensureColumn()`.
- Optional: lightweight caching for hot reads (in-process or Redis) — only if measured.

**Primary files:** `server/src/services/store.ts`, `server/src/db.ts`,
`server/src/routes/{assessments,audit}.ts`, `server/src/routes/upload.ts`, new
`server/src/services/storage.ts`, `client/src/api/client.ts` +
`client/src/pages/{Dashboard,AuditTrail}.tsx`, `API_CONTRACT.md`.

**Acceptance:** list endpoints return paginated results with total/next; client lists
page correctly; evidence read/write goes through the storage interface (FS impl passes
existing flows); migration runner applies a versioned migration; backup/restore steps
verified against a copy.

### WS-5 — Deployment & Operations  *(Effort: M)*

**Current:** Dev-only run (`npm run dev`). No Dockerfile/compose, no production
deployment guide, no operator runbook, no formal migration system (see WS-4).

**Target:** Reproducible container build and a documented production deploy + operate
story.

**Changes:**
- Add **Dockerfile(s)**: multi-stage build for the server (Node 22, native
  `better-sqlite3` compile) and a static build/serve for the client; a root
  `docker-compose.yml` wiring server + client (+ Postgres/Redis if chosen).
- Handle the SPA: either serve `client/dist` from Express in prod or via a static
  container; document the chosen path.
- Add **`docs/DEPLOYMENT.md`** (env-var checklist incl. prod-required `AUTH_SECRET`,
  `CLIENT_ORIGIN`, `PUBLIC_URL`, OAuth/SMTP; reverse-proxy/TLS notes; build/run) and
  **`docs/RUNBOOK.md`** (backup/restore, migrations, log locations, health checks,
  rotating secrets, scaling notes).
- Add a `.dockerignore`; ensure `uploads/` and the DB are on persistent volumes.

**Primary files:** new `server/Dockerfile`, `client/Dockerfile`,
`docker-compose.yml`, `.dockerignore`, `docs/DEPLOYMENT.md`, `docs/RUNBOOK.md`;
possibly `server/src/index.ts` (serve static dist in prod).

**Acceptance:** `docker compose up` brings up a working portal reachable end-to-end;
deployment + runbook docs let a fresh operator deploy, back up, and restore.

### WS-6 — Internationalization *(Effort: L; only if D2 = include)*

**Current:** All UI strings hardcoded English; no i18n lib; no locale formatting layer.

**Target:** Strings externalized; locale switchable; dates/numbers locale-aware.

**Changes:** add `react-i18next`, extract strings from `client/src/**` into resource
bundles, add a locale switcher, and route date/number formatting through `format.ts`.

**Primary files:** `client/src/` broadly, new `client/src/i18n/*`, `client/src/lib/format.ts`.

**Acceptance:** UI renders from a translation bundle; switching locale updates strings
and formats; English bundle is complete.

## 4. Suggested Phasing

1. **Phase 1 (foundation):** WS-1 (CI/lint/tests) + WS-3 dependency remediation —
   establishes a safety net before larger changes.
2. **Phase 2 (resilience):** WS-2 observability + remaining WS-3 (audit immutability,
   SECURITY/Dependabot, upload scan hook).
3. **Phase 3 (scale):** resolve D1, then WS-4 (pagination, storage interface,
   migrations/backup).
4. **Phase 4 (ship):** WS-5 Docker + docs/runbook.
5. **Optional:** WS-6 i18n if D2 = include.

## 5. Agent Orchestration Plan (for later parallel execution)

Group work to minimize file collisions. `server/src/index.ts`, `store.ts`, and both
`package.json` files are the shared hot spots — serialize edits to those.

| Agent | Workstream(s) | Mostly-new / low-collision files | Notes |
| --- | --- | --- | --- |
| A | WS-1 CI + lint + configs | `.github/`, eslint/prettier/editorconfig, root scripts | Touches `package.json` first |
| B | WS-1 tests (client + API) | new `*.test.tsx`, `server/test/api.*` | Read-only on app code |
| C | WS-2 observability | new `middleware/*`, error boundary; edits `index.ts`, `claudeProvider.ts` | Owns `index.ts` edits |
| D | WS-3 deps + audit + security docs | `extraction/evidenceExtraction/exporter.ts`, `store.ts`+`db.ts` audit, `SECURITY.md`, dependabot | Owns `store.ts`/`db.ts` edits |
| E | WS-4 pagination + storage + migrations | new `storage.ts`, routes, client lists | Coordinate `store.ts` with D / run after D |
| F | WS-5 Docker + ops docs | `Dockerfile`s, compose, `docs/*` | Mostly new files |

Run A, B, C, F in parallel safely; sequence D → E (both touch the data layer);
integrate via PR with CI (from A) as the gate. Prefer isolated git worktrees per agent
if running concurrently.

## 6. Verification (per workstream)

- **WS-1:** open a PR; confirm CI runs and gates; break a test to confirm red.
- **WS-2:** `npm run dev:server`, hit endpoints, confirm JSON logs + request-id
  correlation; force a Claude failure and confirm rule-engine fallback (no 5xx);
  `curl /api/health` shows `db: ok`.
- **WS-3:** `npm audit` clean of highs; `npm test` extraction/export green on
  `exceljs`; attempt `UPDATE audit_log` → rejected.
- **WS-4:** call list endpoints with `limit/offset`; confirm paging + totals; exercise
  evidence upload/download through the storage interface; apply a migration; do a
  backup→restore on a DB copy.
- **WS-5:** `docker compose up` → full create→upload→analyze→approve→export flow works;
  follow `DEPLOYMENT.md` from scratch.
- **WS-6 (if included):** switch locale; confirm strings + date/number formats change.

## 7. Out of Scope

Reworking the analysis/scoring model, new analyst features, multi-tenant data
isolation (call out as a future spec if needed), and a background job queue. The
Spec 0001 principle — AI is preliminary, the human analyst decides — is unchanged.
