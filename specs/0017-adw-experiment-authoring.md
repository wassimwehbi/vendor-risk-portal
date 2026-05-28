# Spec 0017 — Author experiments end-to-end from the portal via ADW

- **Status:** Implemented (2026-05-27)
- **Branch:** `feat/0017-adw-experiment-authoring`
- **Location:**
  - `portal/src/components/CreateWithAI.tsx` (new),
    `portal/src/lib/adwIssue.ts` (new),
    `portal/src/lib/github.ts` (createIssue / getRepoPermissions / listPageFiles),
    `portal/src/App.tsx` (`ai` view + collaborator gate),
    `portal/src/components/Dashboard.tsx` (Create-with-AI CTA),
    `portal/src/config.ts` (`ADW_LABEL`),
  - `scripts/experiments.mjs` (dead-experiment guard),
  - `specs/adw/RECIPE-new-experiment.md` (new — the authoritative how-to ADW follows),
  - `experiments/dashboard-cta.yml` (unchanged — referenced).
- **Related docs:**
  `specs/0015-experimentation-platform.md` (the A/B platform this extends),
  `specs/0008-zte-agentic-layer.md` (the ADW pipeline this triggers),
  `specs/0011-adw-ship-only-trigger.md` (label-triggered ADW conventions),
  `specs/0014-design-system.md` (UI rules the build agent must follow).

## 1. Problem / Objective

Today, making an A/B experiment "real" takes **two disconnected experiences**:

1. A developer hand-wires the **product code** — `useVariant('<key>')` in a page (branching UI
   on `variant === 'treatment'`) plus `api.trackEvent('<metric>')` at the goal action.
2. Someone authors the **config card** `experiments/<key>.yml` (today, via the portal's
   `ExperimentForm` → config-only PR).

The portal owns step 2 but not step 1, so launching a new experiment still requires a manual
code change from a separate experience. Worse, there's **no typed link** between the YAML's
variant key / metric name and the literals in code (`Dashboard.tsx` L16–18 documents this
caveat explicitly): a typo in either silently serves control forever, all CI green — the
classic "dead experiment" failure that's invisible because it produces no exposures.

Objective: collapse steps 1 and 2 into one portal action. A signed-in collaborator fills a
short guided form (+ a free-text treatment description) and the portal fires the repo's ADW
pipeline (by creating an `adw:zte`-labeled GitHub issue) to wire the product code AND create
the first draft config card in a single auto-merged PR. After merge, the existing portal Edit
form refines the card (status, weights, dates). Close the typed-link gap with a platform-wide
static guard so any future hand-authored typo is also caught.

## 2. Approach & Changes

### Division of labor
- **Portal** owns identity, uniqueness, and the collaborator gate (the things that need live
  GitHub state at submit-time).
- **The composed issue body** owns the contract — three mandatory deliverables, explicit file
  paths, the literal draft card to drop in, pinned literal strings, acceptance criteria.
- **ADW** owns the mechanics — driven by the issue body and the recipe file. The recipe
  carries the heavy detail (Dashboard.tsx pattern, NewAssessment.tsx pattern, validate step,
  draft-card template, UX-scenario rules, design-system enforcement) so the body stays
  scannable and the recipe stays maintainable.

### Files

#### `portal/src/lib/github.ts`
Add three helpers reusing the existing `gh<T>()` wrapper:
- `createIssue(token, { title, body, labels })` → `POST /repos/${REPO}/issues`. A single
  create-with-label REST call triggers `adw-zte.yml` (`issues: opened` + `contains(labels,
  'adw:zte')` is satisfied on the same event), so no separate label call is needed.
- `getRepoPermissions(token)` → `GET /repos/${REPO}` returning `{ push: boolean }`. Mirrors
  both the server's results collaborator-gate and the workflow's `author_association ∈
  {OWNER, MEMBER, COLLABORATOR}` check.
- `listPageFiles(token)` → `client/src/pages/*.tsx`. Powers the page-file dropdowns so the
  human picks paths instead of typing them.

#### `portal/src/lib/adwIssue.ts` (new)
`composeAdwIssue(payload)` → `{ title, body, draft }`. Pure module. Builds a draft
`Experiment` (status: draft, control/treatment 50/50, optional targeting, metric.primary set,
no `tracking_issue` — the recipe tells ADW to fill it with the live issue number), renders it
with `toYaml()`, and composes a checklist-shaped Markdown body whose sections are:
- "This is a `/feature`" lead (steers the classifier).
- A "Read these first" list of canonical files + the recipe pointer.
- **Three mandatory deliverables** (card / wiring / conversion).
- A `Structured fields` code block (verbatim values).
- The **literal draft YAML** in a fenced block.
- **String-byte-identity acceptance criteria** (key↔filename, key↔useVariant, metric↔trackEvent,
  variant key↔`'treatment'`, no control-path change).
- Hypothesis + a footer naming the dead-experiment guard.

#### `portal/src/components/CreateWithAI.tsx` (new)
Guided form: `key`, `name`, `pageFile` (dropdown from `listPageFiles`), `goalActionFile`
(separate dropdown — distinct file is the top mitigation for "wires only half"),
`goalAction` text, `primaryMetric` (snake_case), optional `surface` (defaults from
page-file basename), optional roles checkboxes + tenant CSV, optional hypothesis, and a
**Treatment UI** textarea (the only free-text prompt). Pre-flight duplicate-key check uses
the already-loaded `experiments` list. A `Preview the ADW issue` toggle shows the composed
title + body verbatim before submit so the human can audit what ADW will read.

#### `portal/src/App.tsx`
Adds `'ai'` to the view union; on sign-in fetches `getRepoPermissions` + `listPageFiles`
in addition to the existing viewer + experiments. The Create-with-AI CTA is **gated on
`push: true`** so a non-collaborator never sees a button that silently no-ops at the
workflow's author gate. On success, navigates back to the dashboard with a banner linking
the created issue: *"ADW is building this experiment — it'll appear here once the PR
merges (usually 10–20 min)."*

#### `portal/src/components/Dashboard.tsx`
Adds the **Create with AI** primary CTA next to a now-secondary `+ New experiment`. The
existing config-only authoring + Edit flows are untouched and remain useful (e.g. for
cards whose code is already wired or for editing weights / status).

#### `scripts/experiments.mjs` — dead-experiment guard
Extends `validate` / `build` so that, after schema + cross-file checks, the script reads
`client/src/**/*.{ts,tsx}` once and confirms, per card, that:
- `useVariant('<key>')` or `useFlag('<key>')` exists, and
- `trackEvent('<metrics.primary>')` exists.

Severity: **error** when `status: running` (a live experiment that's inert is the worst
silent failure); **warning** for `draft`/`paused`/`completed` and for unwired **secondary**
metrics. Warnings print but never fail the build. Scoped this way so:
- The current `main` keeps passing (`dashboard-cta` running is wired; its unwired secondary
  `analyze_clicked` only warns).
- The autonomous ADW draft PR stays green (warnings only).
- The human's draft→running Edit PR is the gate that turns the warning into an error,
  protecting the live flip while keeping ADW's PR hands-off.

#### `specs/adw/RECIPE-new-experiment.md` (new)
The authoritative how-to ADW reads. Located in `specs/adw/` (out of the curated `NNNN`
namespace, per `CLAUDE.md`'s ADW-spec convention). Sections: files to read first; the
**literal draft card template** (50/50 + draft + `tracking_issue: <this issue's number>`);
the `useVariant` pattern (treatment fully flag-gated, control byte-identical); the
`trackEvent` pattern; validate as a build/test task (not ship — ship doesn't auto-fix
`experiments`); UX scenario rules (reuse existing route's scenario, don't add new); the
design-system enforcement block; and a quick failure-modes-and-mitigations table.

## 3. Key Decisions & Rationale

### A. First card = `status: draft`, 50/50 — chosen
Reasoning grounded in `scripts/experiments.mjs:96`: the audience-overlap scan is gated on
`status === 'running'`. A draft card is **excluded entirely**, making the new card's
validity *independent of the rest of the registry*. Combined with `assignVariant` returning
`null` for non-running cards (so `useVariant` returns the `fallback` of `'control'`), the
auto-merged PR is **provably inert** — no user sees a behavior change until a human flips
the card to running via the existing Edit form.

This pushes the only validation that depends on global state (running-only audience
overlap) out of the autonomous PR and into the human-driven Edit PR, which is exactly the
right division.

### B. Static dead-experiment guard now, not deferred
Without it, the entire feature can produce a green, merged, dead experiment — the worst
kind of failure because it's invisible and runs for weeks collecting zero exposures. The
guard is small (one regex sweep over `client/src`) and benefits the *whole* platform, not
just ADW-created experiments: any future hand-authored typo is caught. Error for running,
warning otherwise — chosen so it doesn't ambush the autonomous draft PR (everything still
goes green) while protecting the human's draft→running flip.

### C. Guided form, not a free-text prompt
The Plan agent's analysis: the single biggest "ADW wires only half" mitigation is making
the `page-file` and `goal-action-file` **distinct, explicit** path fields the human picks
from a dropdown. The free-text prompt remains — as a Treatment-UI description — but the
mechanics (key, metric, file paths, targeting) are structured.

### D. Issue body short; recipe carries the weight
ADW's planner sees only `{ number, title, body }`. The build agent then has full repo
access. So the body is the contract (deliverables + literal strings + literal YAML); the
recipe is the mechanical detail (excerpts of `Dashboard.tsx`/`NewAssessment.tsx` patterns,
the draft template, UX rules). The body references the recipe with a stable repo path —
the build agent reads it.

### E. Collaborator gate on the portal CTA
The `adw-zte.yml` workflow gates on `author_association ∈ {OWNER, MEMBER, COLLABORATOR}`,
so a non-collaborator's issue is silently ignored. The portal mirrors the gate
client-side using `GET /repos/{owner}/{repo}` `permissions.push` — the same signal the
server already uses for results auth. The CTA simply doesn't render for a non-collaborator,
removing the most confusing failure mode.

### F. Auto-merge stays (existing ZTE behavior), made safe by draft
The user asked for "deployed/merged." `adw_ship.py` squash-merges autonomously when the
required checks (`quality`, `e2e`, `docker`, `Analyze (javascript-typescript)`,
`experiments`, optionally `ux`) go green. Draft-first makes that safe: the merged PR
changes no user-visible behavior; the human owns the draft→running flip.

## 4. Verification

- **Guard, no regressions on `main`:**
  `node scripts/experiments.mjs validate` → exit 0, one warning for the (intentionally
  unwired) `analyze_clicked` secondary metric on `dashboard-cta`. Verified.
- **Guard catches a broken running card:**
  A temporary `experiments/zguard-probe.yml` with `status: running` and a nonexistent metric
  produced two errors (key↔code + metric↔code) and exit 1. Flipping it to `status: draft`
  downgraded both to warnings; exit 0. Verified, probe removed.
- **Portal builds:** `cd portal && npm run build` → `tsc --noEmit && vite build`, clean.
- **End-to-end (live, user-driven, post-merge):** sign into the deployed portal, click
  "Create with AI", fill the form against a known page + a real goal action, preview the
  composed body, submit; confirm ADW opens a PR that creates the draft card, wires
  `useVariant` + the conversion event, goes green on all required checks (including the
  guard's warnings for the draft), and auto-merges. The new experiment appears on the
  dashboard; the Edit form refines it.

## 5. Known limitations / follow-ups

- The guard checks the experiment **key** and **primary metric** literals, not the freeform
  `=== 'treatment'` comparison; the recipe + issue acceptance criteria pin the `treatment`
  literal. A future tightening could grep for `<variantString>` literals near each
  `useVariant('<key>')` site, but the false-positive risk is meaningful.
- The recipe is repo-local prose, not a typed contract. A future improvement would express
  the same invariants as a typed `defineExperiment(key, variants, metrics)` builder that
  the build agent could call from code — eliminating the string-drift class entirely.
- A non-collaborator could still create an issue *outside* the portal; the `adw-zte.yml`
  author gate remains the real control. The portal gate only prevents the confusing silent
  no-op for legitimate users without push access.
- ADW picking the wrong handler for an ambiguous goal action is mitigated by the explicit
  `goal-action-file` field, not eliminated; the reviewer agent's acceptance check + the
  human draft→running step are the backstops.
- Duplicate issues from the user double-clicking aren't deduped by the workflow's
  concurrency key (which serializes runs of the *same* issue, not distinct issues for the
  same experiment). The portal's submit button disables during the in-flight POST and
  duplicate-key pre-flight catches the second click after the first issue's PR opens; in the
  narrow race window between, the validator's duplicate-key check is the backstop.
