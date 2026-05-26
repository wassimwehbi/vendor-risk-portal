# Spec 0006 — CI/CD Pipeline & Test Buildout

- **Status:** Implemented (2026-05-25)
- **Branch:** `feat/ci-cd-pipeline`
- **Location:**
  - `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`
  - `biome.json`, `lefthook.yml`
  - `server/src/app.ts` (new), `server/src/index.ts`, `server/test/api.integration.test.ts`, `server/.c8rc.json`
  - `client/vite.config.ts`, `client/src/test/setup.ts`, `client/src/**/*.test.{ts,tsx}`
  - `playwright.config.ts`, `e2e/smoke.spec.ts`
  - root / `server/` / `client/` `package.json` (+ lockfiles), `README.md`
- **Related docs:** `specs/0002-enterprise-readiness.md` (this implements **WS-1**),
  `specs/0004-free-demo-deployment.md` (the deploy targets this gates), `README.md`, `API_CONTRACT.md`
- **Builds on:** Spec 0001 (the app), Spec 0003 (multi-tenancy/RBAC — covered by the integration tests).

## 1. Problem Statement & Objective

The portal had **no CI/CD**: no `.github/`, no linter/formatter, no automated quality gate.
Render (backend) and Cloudflare Pages (frontend) already auto-deploy on every push to `main`
via their own git integrations — so a typecheck error, broken test, or broken `Dockerfile`
could reach production before anyone noticed. Testing was **server-only** (unit tests hitting
services/stores directly); there were no client tests, no HTTP/integration tests, no coverage,
and no end-to-end coverage.

Objective: add a lean, GitHub-native pipeline that gates every change behind lint + typecheck +
test + build (+ Docker build, dependency audit, CodeQL) so that — combined with branch
protection — **only green code lands on `main`, and therefore only green code auto-deploys**.
No deploy secrets enter GitHub; the existing platform auto-deploy is unchanged. As part of the
same work, fill the testing gaps: client unit tests, server HTTP integration tests, coverage
reporting, and a Playwright E2E smoke flow — all running in CI.

## 2. Decisions

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| 1 | Deploy model | **CI as a merge gate** (branch protection); keep Render/Cloudflare auto-deploy | Lowest-risk; no deploy credentials in GitHub. Only-green-merges ⇒ only-green-deploys. |
| 2 | Lint/format | **Biome** | One fast tool for lint + format + import-sort; minimal config. |
| 3 | Git hooks | **lefthook** | Single declarative config; pre-commit format/lint, pre-push typecheck. |
| 4 | Extras | Docker build check, Dependabot, `npm audit`, CodeQL | All requested. |
| 5 | Testing | Client unit (Vitest+RTL), server integration (supertest), coverage, Playwright E2E | Closes the WS-1 testing gaps. |

## 3. Approach & Changes

GitHub Actions, Node pinned via `.nvmrc` (22.18.0), `npm ci` across the three lockfiles
(root, `server/`, `client/`) cached by `actions/setup-node`.

### Workflows
- **`ci.yml`** (PR + push to `main`; `concurrency` cancels superseded runs; `permissions: contents: read`). Jobs:
  - **`quality`** — `npm run check` (Biome) → `npm run typecheck` → `npm run test:coverage`
    (server unit+integration under c8; client Vitest) → `npm run build`. Uploads `lcov` as an
    artifact; warn-only (no failing threshold).
  - **`e2e`** — `npx playwright install --with-deps chromium`, then `npm run test:e2e`. Uploads
    the Playwright HTML report.
  - **`docker`** — buildx build of the server image (`push: false`, GHA layer cache) so a broken
    `Dockerfile`/native `better-sqlite3` build fails here, not on Render.
  - **`audit`** — `npm audit --omit=dev --audit-level=high` for root/server/client, **informational**
    (`|| true`): surfaces advisories in the logs without blocking.
- **`codeql.yml`** — CodeQL `javascript-typescript` on push/PR + weekly schedule.
- **`dependabot.yml`** — weekly `npm` updates for `/`, `/server`, `/client` and `github-actions`, grouped.

### Tooling
- **Biome** (`biome.json`): formatter (2-space, single quotes, width 120) + `recommended` linter +
  import-sort assist off. A one-time `biome check --write` reformatted 49 files (committed separately).
  Several `recommended` rules that fire on existing idiomatic code are disabled with follow-ups (see §6).
- **lefthook** (`lefthook.yml`): pre-commit runs `biome check --write` on staged files (re-stages
  fixes); pre-push runs `npm run typecheck`. Installed via the root `prepare` script (`lefthook install || true`).

### Server refactor (the only product-code change)
`server/src/index.ts` built the Express `app` and called `app.listen()` in one file. App
construction moved into **`server/src/app.ts`** exporting `createApp()`; `index.ts` is now the
entrypoint (loads env, runs `bootstrapMultiTenancy()`, `createApp()`, `listen`). Behavior-preserving;
lets `supertest` mount the app with no open port.

### Tests
- **Server integration** (`server/test/api.integration.test.ts`, `supertest`): health is public;
  unauthenticated → 401; missing CSRF → 403; analyst flow (load demo scenario → analyze → approve);
  Viewer cannot create (403); cross-tenant read → 404. Sets `VRP_DB_PATH`/`AUTH_MODE=dev`/`AUTH_SECRET`
  before importing `createApp` (mirrors the existing unit tests). Server scripts run with
  `--test-force-exit` because the session store's cleanup `setInterval` would otherwise keep the
  process alive after tests pass.
- **Server coverage** via `c8` (`server/.c8rc.json`, text + lcov).
- **Client unit** (Vitest + RTL, jsdom; `client/src/test/setup.ts` loads jest-dom matchers):
  `lib/format.ts`, `RiskBadge`, `StatusChip`, and a mocked-`fetch` test of `api/client.ts`
  (CSRF header, 401 handling). Vitest config + v8 coverage live in `client/vite.config.ts`.
- **E2E** (`playwright.config.ts` + `e2e/smoke.spec.ts`, Chromium): a `webServer` boots the API
  (`AUTH_MODE=dev`, throwaway SQLite, no `ANTHROPIC_API_KEY`) and the Vite dev server (proxying
  `/api`). The spec covers the sign-in redirect and dev sign-in → load demo scenario → analyzed
  risk band (offline rule engine).

### Branch protection (applied once via `gh`, not stored in the repo)
```bash
gh api -X PUT repos/wassimwehbi/vendor-risk-portal/branches/main/protection \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "checks": [
    { "context": "quality" }, { "context": "e2e" }, { "context": "docker" },
    { "context": "Analyze (javascript-typescript)" }
  ]},
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```
(Status-check contexts equal the job ids `quality`, `e2e`, `docker`; CodeQL's context is its job
**name**, `Analyze (javascript-typescript)` — now included so a CodeQL failure also blocks merge.)

### Automatic Copilot code review (ruleset, applied once — not stored in the repo)
Copilot code review is a **native GitHub PR reviewer**, not a CI/Actions job, so it lives in a
repository **ruleset** rather than `ci.yml`. Applied once on the default branch:
```bash
gh api -X POST repos/wassimwehbi/vendor-risk-portal/rulesets \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "name": "Copilot review for default branch",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "copilot_code_review",
      "parameters": { "review_on_push": true, "review_draft_pull_requests": false } }
  ]
}
JSON
```
`review_on_push: true` ⇒ Copilot re-reviews on every push to an open PR (the "review each commit"
intent; reviews are per-PR-push, not per-individual-commit). `review_draft_pull_requests: false`
skips drafts to conserve premium-request quota.

## 4. Key Decisions & Rationale

- **Gate, not deploy-owner** — Render/Cloudflare own deploy; branch protection on `main` is what
  makes deploys green, with zero deploy credentials in GitHub.
- **Single `quality` job** — small repo; one shared install beats parallel jobs.
- **`createApp()` over a real port** — supertest mounts the app directly; no flaky teardown, reuses
  the env-before-import DB pattern.
- **E2E fully offline** — dev-login + the demo-scenario loader + the rule-engine fallback need no
  keys; Chromium-only keeps it stable.
- **Coverage & audit warn-only** — encourage tests / surface CVEs without blocking day-one merges.

## 5. Verification

Locally (Node 22 via `.nvmrc`/fnm): `npm run check`, `npm run typecheck`, `npm run test:coverage`,
`npm run build`, `npm run test:e2e` all pass. Results: Biome `ci` exit 0; **59** server tests
(52 unit + 7 integration); **16** client tests; client build OK; **2** E2E tests pass. The Docker
build is exercised by the `docker` CI job (Docker is not installed on the dev machine). On a PR:
the `quality`/`e2e`/`docker`/`audit` + CodeQL runs appear; a deliberately broken test/type fails
`quality`; with branch protection on, a red PR cannot merge and a green one can; merging to `main`
still triggers the existing Render + Cloudflare auto-deploys.

## 6. Known Limitations / Follow-ups

- **Starter coverage, not exhaustive** — client/integration/E2E are a meaningful smoke layer meant
  to grow; coverage has no failing threshold yet (promote once a baseline settles).
- **Disabled Biome rules to re-enable incrementally:** `a11y/useButtonType`,
  `correctness/{useExhaustiveDependencies,noVoidTypeReturn}`,
  `suspicious/{noArrayIndexKey,noExplicitAny,noImplicitAnyLet,useIterableCallbackReturn}`,
  `style/noNonNullAssertion`. A few `recommended` **warnings** remain (e.g. `noGlobalIsNan`) — visible, non-blocking.
- **`npm audit` is informational** — flip to blocking (drop `|| true`) once the dependency tree is clean
  (currently a few pre-existing transitive advisories in `pdf-parse`/`xlsx`-adjacent deps).
- **E2E is Chromium-only**; add Firefox/WebKit later if flake stays low.
- **`better-sqlite3` is ABI-pinned to Node 22** — local runs must use Node 22; CI already does.
- **Deploy-on-green is indirect** (branch protection), not GitHub-orchestrated. Revisit a
  GitHub-owned deploy (Render hook + Cloudflare Wrangler) only if rollback/deploy-gating control is needed.
- **Branch protection is applied once manually** (documented above); it is not stored in the repo.
- **Automatic Copilot code review** is a repository **ruleset** (documented above), also applied once
  and not stored in the repo. It is **advisory** — Copilot leaves review comments, not an approving
  review — so it is auto-*requested*, **not** a merge-gating required check. It only runs when the PR
  author has Copilot code-review access (Pro/Pro+/Business/Enterprise) with premium-request quota
  remaining. The ruleset's `deletion`/`non_fast_forward` rules overlap the branch protection above —
  redundant but harmless.
