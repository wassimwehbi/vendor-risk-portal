# Spec 0015 — Experimentation platform (software-layer A/B testing + GitHub portal)

- **Status:** Phase 1 implemented (config foundation, 2026-05-27). Phases 2–4 planned.
- **Branch:** `feat/0015-experiments-config` (Phase 1)
- **Location (Phase 1):** `experiments/` (new — `schema.json`, `dashboard-cta.yml`, `README.md`),
  `scripts/experiments.mjs` (new), `.github/workflows/validate-experiments.yml` (new),
  `adws/adw_modules/ship_ops.py` (add `experiments` required check),
  root `package.json` / `package-lock.json` (add `js-yaml`, `ajv` devDeps).
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

## 4. Verification

- `node scripts/experiments.mjs validate` → `✓ 1 experiment(s) valid.` (exit 0) on the sample.
- Negative cases exit 1 with a clear message: weights ≠ 100, `key` ≠ filename, duplicate keys,
  un-parseable YAML, two running experiments overlapping on a surface. (Verified locally.)
- `node scripts/experiments.mjs build` writes `server/src/data/experiments.json` with all
  definitions (used from Phase 2 onward).
- CI: the `experiments` job runs on this PR and goes green.
- `npm run check` (Biome) is unaffected — `scripts/` and `experiments/*.yml` are outside its
  `files.includes`.

## 5. Known limitations / follow-ups

- **No runtime behavior yet.** Phase 1 only validates config; nothing assigns variants until
  Phase 2 (server) + Phase 3 (client). The sample stays `draft`.
- **Branch protection is a separate admin step.** `experiments` is added to the ADW ship
  loop's checks here, but making it merge-blocking at the GitHub level requires adding it to
  the `main` ruleset (repo setting) once the check has run at least once.
- **Pause latency ~ redeploy time** (by design). A live poll or DB kill-switch override is a
  later option if instant pause is needed.
- **Phase 2–4 specifics** (assignment hashing, telemetry tables, device-flow CORS relay,
  results z-test, the Pages portal + OAuth app) are summarized in §1–2 and will be detailed as
  each phase lands; a scheduled Action commenting results onto each `tracking_issue` is an
  optional later enhancement.
