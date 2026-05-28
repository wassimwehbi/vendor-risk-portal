# Spec 0019 — Experiments catalog: prerequisites for local form testing

- **Status:** Implemented (2026-05-28)
- **Branch:** `feat/0017-prereq-catalog`
- **Location:**
  - `experiments/catalog.yml` (new — the PM-facing catalog seed).
  - `experiments/catalog.schema.json` (new — the JSON Schema it validates against).
  - `scripts/experiments.mjs` (dead-experiment guard + catalog bidirectional drift checks,
    landing now so the `experiments` CI gate enforces catalog↔code invariants from the
    moment the catalog is on `main`).
  - `portal/src/lib/github.ts` (`RESERVED_EXPERIMENT_FILES` exclusion so the live prod
    portal's `listExperiments` does NOT try to parse `catalog.yml` as an Experiment card
    and break the dashboard).
- **Related docs:**
  `specs/0015-experimentation-platform.md` (the A/B platform this extends),
  `specs/0017-adw-experiment-authoring.md` (the PM form + composer that depends on this
  catalog — landing in a subsequent PR).

## 1. Problem / Objective

Spec 0017's PM-facing "Create with AI" form reads `experiments/catalog.yml` from the
default branch via the GitHub Contents API. To **test that form locally** (running the
portal dev server off the spec-0017 branch but the catalog comes from `main`'s
`experiments/catalog.yml`), the catalog and its CI gate must already be on `main`.

Landing the whole of spec 0017 in one PR has two problems:

1. **Local testing is blocked.** The form's `fetchCatalog` returns 404 against `main`,
   the portal goes fail-closed, and the form never renders — defeating the point of
   the local validation pass.
2. **The live prod portal breaks the moment `catalog.yml` reaches `main`.** The deployed
   `wassimwehbi.github.io/vendor-risk-portal/` calls `listExperiments`, which globs
   `experiments/*.yml`. Without the `RESERVED_EXPERIMENT_FILES` exclusion, the live
   dashboard tries to `parseExperiment(catalog.yml)`, throws `'missing required
   fields'`, surfaces the error banner, and shows zero experiments — a P0 dashboard
   regression for every signed-in user.

This PR ships the **minimum infrastructure** that resolves both: the catalog files,
the validator's catalog-awareness, and the listExperiments exclusion. Everything else
in spec 0017 (the form rewrite, the three-template composer, the recipe updates, the
design-system additions) stays in PR #75.

## 2. Approach & Changes

Surgical split, optimized for "ship-now-test-later":

- **The catalog files themselves** (`catalog.yml` + `catalog.schema.json`) — including
  the post-code-review handler_hint corrections (e.g. ReportView is `<a href>`, not
  `<button onClick>`).
- **The full `scripts/experiments.mjs`** including:
  - The dead-experiment guard (spec 0017 v1) — `dashboard-cta` is already wired, so it
    passes on `main`.
  - The bidirectional catalog drift checks — instrumented → forward error, proposed →
    proposed-stale warning, code-without-catalog → reverse warning, file existence →
    error.
  - The hygiene fixes from the spec-0017 code-review pass: comment stripping, word
    boundary, test-file exclusion.
- **The `portal/src/lib/github.ts` `RESERVED_EXPERIMENT_FILES` exclusion.** Nothing
  else from spec 0017's `github.ts` changes (`createIssue`, `getRepoPermissions`,
  `fetchCatalog`) — those have no callers without the form and would be dead code.

## 3. Key Decisions & Rationale

### Ship the full validator now, not just the catalog files
Without the catalog cross-check in `scripts/experiments.mjs`, the catalog could land on
`main` and silently drift — engineers add a `trackEvent('foo')` without a catalog row,
or vice-versa, and nothing complains until the form lands and a PM picks the broken
entry. Landing the validator simultaneously closes the gate from day one.

### Surgical github.ts change, not the full spec-0017 file
The other `github.ts` additions (`createIssue`, `getRepoPermissions`, `fetchCatalog`)
need the spec-0017 form to mean anything. Shipping them now would be dead code on prod
and noise in the diff. The `RESERVED_EXPERIMENT_FILES` exclusion is the only piece
that protects the live portal.

### No new portal recipes / form / types / spec doc beyond this one
Same rationale: those changes need the form to be useful. Deferring them keeps the
prereq PR small and reviewable.

### Spec 0017 PR (#75) will rebase cleanly after this merges
The catalog files, the validator changes, and the listExperiments exclusion on the
spec-0017 branch are byte-identical to what this PR ships, so the rebase produces
"already applied" / clean tree merges for those paths. The remaining spec-0017 diff
(the form, the composer, the recipes, the design-system additions, the spec doc, the
RECIPE update) is the actual PR review surface for #75.

## 4. Verification

- `node scripts/experiments.mjs validate` → exit 0 with one expected warning
  (`dashboard-cta`'s secondary `analyze_clicked` metric — unchanged from `main`'s
  baseline since the catalog declares it as `status: proposed` on ReviewWorkspace,
  matching the existing CI behavior).
- Probe: temporarily flip a catalog row's `assessment_created` metric to a nonexistent
  key with `status: instrumented` → 2 errors / exit 1 (forward drift catches it).
- Probe: flip to `status: proposed` → stale warning / exit 0.
- Portal still compiles (`cd portal && npm run build`). The `listExperiments` change
  is a one-line filter narrowing; no API surface change.
- Server typecheck unaffected (no server code changes in this PR).

## 5. Local-testing workflow this enables

After this PR merges + the portal-pages workflow redeploys
`wassimwehbi.github.io/vendor-risk-portal/`:

```sh
git checkout feat/0017-adw-experiment-authoring
cd portal && npm run dev
```

Open `http://localhost:5174/vendor-risk-portal/`, sign in, and the "Create with AI"
form renders (it reads `catalog.yml` from `main` via the Contents API). The full
walkthrough in the spec-0017 PR description (TEMPLATE A / B / freeform) then becomes
testable end-to-end against the live relay.

## 6. Known limitations / follow-ups

- **PR #75 must rebase** after this merges. The conflicting paths
  (`experiments/catalog.{yml,schema.json}`, `scripts/experiments.mjs`,
  `portal/src/lib/github.ts` for the `RESERVED_EXPERIMENT_FILES` block) ship identical
  content here and on the spec-0017 branch, so the rebase resolves cleanly — but it's
  one extra round-trip the PR-#75 author (me) has to drive after merge.
- **The validator now references `experiments/catalog.yml` from `main`**, so renaming
  or deleting it is a coordinated change with the portal. The spec already documents
  the contract; this prereq doesn't introduce new surface.
