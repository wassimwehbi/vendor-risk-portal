# Spec 0015 — Experimentation platform (software-layer A/B testing + GitHub portal)

- **Status:** Phases 1–4 implemented (config + server + client + portal, 2026-05-27). Phases 1–3
  merged in #54; phase 4 (portal) on its own PR.
- **Branch:** `feat/0015-experiments-config` (1), `feat/0015-experiments-server` (2),
  `feat/0015-experiments-client` (3), `feat/0015-experiments-portal` (4)
- **Location (Phase 1):** `experiments/` (new — `schema.json`, `dashboard-cta.yml`, `README.md`),
  `scripts/experiments.mjs` (new), `.github/workflows/validate-experiments.yml` (new),
  `adws/adw_modules/ship_ops.py` (add `experiments` required check),
  root `package.json` / `package-lock.json` (add `js-yaml`, `ajv` devDeps).
- **Location (Phase 2):** `server/src/services/experiments.ts` (new), `server/src/routes/experiments.ts` (new),
  `server/test/experiments.test.ts` (new), `server/src/db.ts` (telemetry tables),
  `server/src/types.ts` (experiment types), `server/src/app.ts` (mount + CORS), `server/package.json`
  (`gen:experiments` + `predev`), `Dockerfile` (registry build stage), `.gitignore`, `.env.example`.
- **Location (Phase 3):** `client/src/lib/FlagsContext.tsx` (new) + `client/src/lib/FlagsContext.test.tsx` (new),
  `client/src/api/client.ts` (+ `.test.ts`), `client/src/types.ts`, `client/src/main.tsx` (provider),
  `client/src/pages/Dashboard.tsx` (CTA variant), `client/src/pages/NewAssessment.tsx` (conversion).
- **Location (Phase 4):** `portal/` (new Vite/React SPA), `.github/workflows/portal-pages.yml` (new),
  `CLAUDE.md` (design-system skill made a blocking requirement for all UI).
- **Related docs:** `README.md`, `specs/0008-zte-agentic-layer.md` (GitHub-native ADW layer
  this mirrors), `specs/0012-ux-tasks-harness.md` + `specs/0013-adw-branch-sync.md` (the
  always-run required-check pattern and stale-check deadlock lesson reused here).

## 1. Problem / Objective

We want to run **robust A/B tests in the application layer** — feature-flag / variant
branching at runtime, not separate builds and not edge rewrites — and manage those
experiments from a **portal that lives in GitHub**, consistent with this repo's GitHub-native
philosophy (config-as-code, PR-gated changes, ADW).

The platform ships in four phases, each a reviewable PR that extends this spec:

1. **Config foundation** *(this PR)* — experiments as config-as-code + a CI validation gate.
2. **Server engine** — deterministic assignment, flags API, exposure/conversion telemetry,
   results with significance, GitHub device-flow CORS relay.
3. **Client integration** — `FlagsProvider` / `useVariant`, exposure beacon, `trackEvent`,
   one sample experiment wired end-to-end.
4. **Portal** — a custom React/Vite SPA on GitHub Pages that reads experiment YAML + live
   results and authors changes by opening PRs (GitHub OAuth device-flow auth).

## 2. Architecture

```
Portal (GitHub Pages SPA) --device-flow--> opens PR against experiments/*.yml
        │ reads YAML + results                         │
        ▼                                CI `experiments` check (required)
   live results                                        ▼
        ▲                                       merge → main → Render redeploy
        │ flags/expose/events                          │ prebuild: experiments/*.yml → experiments.json
   Render (Express + SQLite) ──────────────────────────┘   loaded at boot
        ▲ GET /api/flags · POST /api/experiments/:key/expose · POST /api/events
        │ GET /api/experiments/:key/results · POST /api/gh-device/{code,token}
   Cloudflare Pages (main client/ SPA): FlagsProvider → useVariant('key') → branch UI
```

Every app route is auth-gated, so **there is no anonymous traffic**: the bucketing subject is
always `user.id` and sticky assignment needs no cookies.

### Phase 1 — what this PR delivers

- **`experiments/`** is the single source of truth. One `*.yml` per experiment;
  [`experiments/schema.json`](../experiments/schema.json) (JSON Schema draft-07) is the
  contract, also usable by editors (`# yaml-language-server: $schema=...`) and the future portal.
- An experiment declares: `key` (== filename), `name`, `status`
  (`draft|running|paused|completed`), weighted `variants` (first = control), optional
  `hypothesis`/`owner`/`surface`/dates, `targeting` (`roles` + `tenants`), `metrics`, and an
  optional `tracking_issue`. See [`experiments/dashboard-cta.yml`](../experiments/dashboard-cta.yml)
  (status `draft` — assigns nothing yet).
- **`scripts/experiments.mjs`** (`js-yaml` + `ajv`, repo-root, no app build):
  - `validate` — schema + cross-file invariants: `key == filename`, keys unique, variant
    weights sum to 100, unique variant keys, `start <= end`, and **no two `running`
    experiments overlap on the same `surface`** for overlapping (`roles` × `tenants`)
    audiences. Exits non-zero with a per-error list.
  - `build` — emits `server/src/data/experiments.json` (mirrors the existing bundled
    `frameworks.json` the server already loads). Wired into the server prebuild in Phase 2;
    not committed in Phase 1 (no consumer yet).
- **`.github/workflows/validate-experiments.yml`** — job `experiments` runs `validate` on
  every push/PR to `main`. It deliberately has **no `paths:` filter** and always runs to a
  conclusion, so it is safe to make a required check.
- **`adws/adw_modules/ship_ops.py`** — `experiments` added to `DEFAULT_REQUIRED_CHECKS` so the
  ADW ship loop waits on it.

### Phase 2 — server engine

- **`services/experiments.ts`** loads the compiled registry at boot (defensive: a
  missing/invalid file → empty registry, so the platform never breaks the app) and exposes
  pure assignment functions:
  - `bucket(key, subjectId)` — `sha256(key:subjectId)` → first uint32 `% 100`; sticky, storage-free.
  - `eligible(exp, scope)` — role/tenant targeting against `req.scope` (omitted facet = everyone;
    an admin in all-tenants mode is excluded from tenant-targeted experiments).
  - `assignVariant(exp, scope)` — `null` unless `running` **and** eligible; else a weighted pick.
  - `evaluateAll(scope)` / `recordExposure` / `recordEvent` / `computeResults`.
- **Telemetry tables** (`db.ts`): `experiment_exposures` (PK `exp_key,user_id` → idempotent,
  first variant render wins) and `experiment_events` (metric hits by `user_id`).
- **Routes** (`routes/experiments.ts`):
  - *Authed* (after `resolveTenant`): `GET /api/flags`, `POST /api/experiments/:key/expose`
    (server recomputes the variant — the client can't pick it), `POST /api/events`.
  - *Public* (before `requireAuth`, for the cross-origin portal): `GET /api/experiments/:key/results`
    (bearer-token gated; per-variant exposed/converted/rate + a two-proportion z-test & 95% CI),
    and `POST /api/gh-device/{code,token}` — the device-flow CORS relay (injects the public
    client_id, holds no secret, returns GitHub's native JSON).
- **`app.ts`** mounts the public router before `requireAuth`, the authed router with the feature
  routers, adds the portal origin to the CORS allow-list, and rate-limits `/api/gh-device`.
- **Registry build path:** `scripts/experiments.mjs build` → `server/src/data/experiments.json`
  (gitignored). Local dev runs it via `predev`; the Docker image builds it in a throwaway stage
  and copies only the JSON, so the runtime never needs js-yaml or the YAML sources. New optional
  env: `EXPERIMENTS_READ_TOKEN`, `EXPERIMENTS_PORTAL_ORIGIN`, `GH_OAUTH_CLIENT_ID`.

### Phase 3 — client integration

- **`FlagsProvider`** (in `main.tsx`, inside `AuthProvider`) fetches `GET /api/flags` once a user
  exists and **re-fetches on tenant switch** (`[user, activeTenantId]`), since targeting is
  tenant-aware. A failed fetch falls back to `{}` — flags never break the app.
- **`useVariant(key, fallback='control')`** returns the assigned variant and fires a **one-time
  exposure beacon**, deduped per experiment per session via `sessionStorage`, only when the user
  is actually enrolled (so exposures count real renders, and React StrictMode double-effects
  don't double-count). **`useFlag(key)`** is the boolean view.
- **`api.getFlags` / `exposeExperiment` / `trackEvent`** added to the client API wrapper.
- **Sample wired end-to-end:** `Dashboard` branches its primary CTA on `useVariant('dashboard-cta')`
  and `NewAssessment` fires `trackEvent('assessment_created')` on creation. The experiment stays
  `draft`, so the treatment is dormant until it is set `running` (via a PR / the Phase 4 portal).

### Review hardening (post multi-agent + Copilot review)

- **Conversions are bound to an experiment.** `experiment_events` gained `exp_key`; `recordEvent`
  attributes an event only to experiments the user was **exposed to** that **declare** the metric.
  This kills cross-experiment contamination when experiments share a metric name, and allow-lists
  metrics (undeclared/garbage metrics record nothing — no unbounded rows).
- **User-level attribution.** The results join is user-level (`exp_key` + `user_id` + `metric` +
  `ts >= first_seen`), matching user-level bucketing — a conversion fired under a different active
  tenant than the exposure is still counted. (Replaces the earlier tenant-strict join, which dropped
  cross-tenant conversions.) `tenant_id` is retained for analytics, not joined on.
- **Schedule enforced.** `assignVariant` now also gates on the `[start, end]` window
  (`withinWindow`), so an expired/not-yet-started `running` experiment assigns nobody.
- **OAuth scope fixed server-side.** The device-flow relay no longer forwards a caller-supplied
  `scope`; it always requests `public_repo`, removing a scope-escalation/consent-phishing vector.
- **Portal CORS scoped.** The Pages origin is granted CORS access (without credentials) to ONLY the
  two public routes via a `cors` delegate — not the whole credentialed `/api` surface.
- **Misc:** runtime registry guard now mirrors the build invariants (≥2 variants, weights sum 100);
  a missing registry warns instead of silently serving control; the relay has a timeout + non-JSON
  safety; `useFlag` no longer hardcodes the control name; the exposure beacon dedup is scoped by
  user + variant; `safeEqual` is shared with `middleware/auth`; results use one SQL pass.

### Phase 4 — GitHub Pages portal

A standalone Vite/React SPA in `portal/`, deployed to GitHub Pages by `portal-pages.yml`
(build-validates on PRs touching `portal/**`; deploys on push to `main`). It is the management
plane, but **GitHub stays the source of truth** — the portal authors changes by opening PRs.

- **Auth:** "Sign in with GitHub" via the OAuth **device flow**, through the server's
  `/api/gh-device/*` relay (no client secret in the browser); token in `sessionStorage`.
- **Reads:** experiment YAML straight from the repo (GitHub Contents API) + live results from
  `GET /api/experiments/:key/results` (read token entered once, in `localStorage`).
- **Authors:** New / Edit / Pause compose the YAML and **open a PR** (branch → commit → PR via the
  GitHub REST API) — every change is reviewed, CI-validated, and auto-deployed on merge.
- **Design system:** the portal does NOT duplicate tokens — `portal/src/styles.css` imports
  `design-system/colors_and_type.css`, and the logo is the canonical `BrandMark` (shield + check).
  CLAUDE.md now makes the `design-system` skill a blocking requirement for all UI (client + portal).
- **Prereqs (set on Render):** `GH_OAUTH_CLIENT_ID`, `EXPERIMENTS_READ_TOKEN`,
  `EXPERIMENTS_PORTAL_ORIGIN`, plus repo Settings → Pages → Source: GitHub Actions.

## 3. Key decisions & rationale

- **Config-as-code, single source of truth (not a DB-of-experiments).** Definitions live in
  the repo so every change is a reviewable, revertible PR — the "portal in GitHub" requirement.
- **Propagation = auto-redeploy on merge.** Merging to `main` triggers Render's push-to-deploy;
  the server reads the bundled registry at boot. Pause/kill = merge `status: paused`. One
  source of truth, no runtime GitHub dependency. **Trade-off:** pause latency = redeploy time
  (~minutes), not instant.
- **Parse YAML with js-yaml `JSON_SCHEMA`.** The default schema turns `2026-05-27` into a JS
  `Date` (YAML 1.1 timestamp) and `yes/no` into booleans; `JSON_SCHEMA` keeps config types
  predictable (dates stay strings).
- **Schema (ajv) + custom invariants.** `schema.json` is the single contract enforced by ajv;
  cross-field rules ajv can't express (weight sum, filename match, audience overlap) are coded
  in the script. Dates use a `pattern` (not `format`) to avoid the `ajv-formats` dependency.
- **Always-run required check.** Mirrors the `ux` check (spec 0012/0013): a path-filtered
  required check that gets *skipped* deadlocks PRs under branch protection, so the job always
  runs (validation is cheap).
- **`surface`-scoped overlap guard, not global.** Forbidding *all* concurrent experiments is
  too strict — independent experiments on different surfaces assign independently and don't
  interfere. We only block collisions on the same declared `surface`.
- **Server recomputes the variant on expose** (the client sends only the key) so assignment is
  authoritative and exposures can't be spoofed. Pure assignment functions keep it unit-testable.
- **Registry is a build artifact, not committed.** The YAML is the only thing the portal edits;
  the JSON is regenerated from it at build/dev time, so the two can never drift.
- **Device-flow relay is required + secret-less.** GitHub's device/token endpoints send no CORS
  headers, so a static SPA can't call them; the relay forwards them with CORS and injects only
  the public client_id. Results use a separate bearer token (the portal calls them cross-origin
  with no app session).

## 4. Verification

- `node scripts/experiments.mjs validate` → `✓ 1 experiment(s) valid.` (exit 0) on the sample.
- Negative cases exit 1 with a clear message: weights ≠ 100, `key` ≠ filename, duplicate keys,
  un-parseable YAML, two running experiments overlapping on a surface. (Verified locally.)
- `node scripts/experiments.mjs build` writes `server/src/data/experiments.json` with all
  definitions (used from Phase 2 onward).
- CI: the `experiments` job runs on this PR and goes green.
- `npm run check` (Biome) is unaffected — `scripts/` and `experiments/*.yml` are outside its
  `files.includes`.

Phase 2 (verified locally with Homebrew `node@22` — system `node 26` breaks the `better-sqlite3`
native ABI):

- `npm --prefix server test` → 89/89 pass, including the new `experiments.test.ts`: bucketing
  determinism/stickiness, ~50/50 weight distribution over 4000 subjects, role+tenant targeting,
  `draft`/`paused` → control, idempotent exposure, the z-test math (p < 0.05 on a 10% vs 25%
  split; null comparison when an arm has no exposures), and the route auth/CSRF/token paths.
- `npm --prefix server run typecheck` and `npm run check` (Biome) both clean.
- `node scripts/experiments.mjs build` then boot the server: `GET /api/flags` returns the
  assigned variant for a targeted user and `{}` otherwise; `expose`/`events`/`results` behave.
- The `docker` CI job exercises the new registry build stage end-to-end.

Phase 3 (client):

- `npm --prefix client test` → 19/19 pass, incl. `FlagsContext.test.tsx` (variant resolution,
  control fallback, one-time exposure beacon, no beacon when unenrolled) and the new API-wrapper
  cases (`/flags`, `/experiments/:key/expose`, `/events`).
- `npm --prefix client run typecheck` and `npm --prefix client run build` both clean; Biome clean.
- To see the treatment locally: set `dashboard-cta` to `running`, `npm --prefix server run
  gen:experiments`, then sign in as an Analyst/Submitter — the CTA changes and exposure/conversion
  rows appear; `GET /api/experiments/dashboard-cta/results` (with the read token) reflects them.

Phase 4 (portal):

- `npm --prefix portal run typecheck` and `npm --prefix portal run build` both clean; the build
  bundles the canonical `--brand-*` tokens (the cross-dir `@import` of `design-system/` resolves).
- `vite preview` + a headless render confirm the sign-in screen mounts with no console errors and
  shows the canonical `BrandMark` (shield + check) in Inter. Live device-flow + PR authoring run
  only from the deployed `github.io` origin (the prod API's CORS blocks `localhost`).
- The `Portal (Pages)` workflow build-validates `portal/` on PRs and deploys on merge to `main`.

## 5. Known limitations / follow-ups

- **Sample experiment is dormant by design.** `dashboard-cta` is `draft`, so the treatment CTA
  never shows and no one is bucketed until it is flipped to `running` (a one-line PR, or the
  Phase 4 portal). The wiring + beacon + conversion are live; only the assignment is gated off.
- **Conversion attribution is coarse.** A user counts as converted if they fire the primary
  metric at least once after exposure (distinct users, `ts >= first_seen`); there's no
  per-session or funnel-window logic yet.
- **Branch protection is a separate admin step.** `experiments` is added to the ADW ship
  loop's checks here, but making it merge-blocking at the GitHub level requires adding it to
  the `main` ruleset (repo setting) once the check has run at least once.
- **Pause latency ~ redeploy time** (by design). A live poll or DB kill-switch override is a
  later option if instant pause is needed.
- **Phase 2–4 specifics** (assignment hashing, telemetry tables, device-flow CORS relay,
  results z-test, the Pages portal + OAuth app) are summarized in §1–2 and will be detailed as
  each phase lands; a scheduled Action commenting results onto each `tracking_issue` is an
  optional later enhancement.
