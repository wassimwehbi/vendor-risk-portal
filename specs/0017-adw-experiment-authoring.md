# Spec 0017 — Author experiments end-to-end from the portal via ADW

- **Status:** Implemented (2026-05-28) — catalog-driven refinement landed on top of the
  initial guided-form drop.
- **Branch:** `feat/0017-adw-experiment-authoring`
- **Location:**
  - `experiments/catalog.yml` (new — PM-facing source of truth),
    `experiments/catalog.schema.json` (new).
  - `portal/src/components/CreateWithAI.tsx` (catalog-driven rewrite),
    `portal/src/lib/adwIssue.ts` (three-template composer + human summary),
    `portal/src/lib/github.ts` (createIssue / getRepoPermissions / fetchCatalog),
    `portal/src/lib/yaml.ts` (parseCatalog),
    `portal/src/types.ts` (Catalog types),
    `portal/src/App.tsx` (`ai` view + collaborator gate + catalog load + fail-closed),
    `portal/src/components/Dashboard.tsx` (Create-with-AI CTA),
    `portal/src/components/ui.tsx` (`AiChip` provenance marker, `Banner` `warn` kind),
    `portal/src/styles.css` (`banner-warn`, `chip-ai` recipes),
    `portal/src/config.ts` (`ADW_LABEL`).
  - `scripts/experiments.mjs` (dead-experiment guard + catalog bidirectional drift checks).
  - `specs/adw/RECIPE-new-experiment.md` (the authoritative how-to ADW follows; TEMPLATE A/B/C).
  - `experiments/dashboard-cta.yml` (unchanged — referenced).
- **Related docs:**
  `specs/0015-experimentation-platform.md` (the A/B platform this extends),
  `specs/0008-zte-agentic-layer.md` (the ADW pipeline this triggers),
  `specs/0011-adw-ship-only-trigger.md` (label-triggered ADW conventions),
  `specs/0014-design-system.md` (UI rules the form and the build agent must follow).

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

A first drop of this feature landed a *guided form* that still made the PM pick file paths
and type metric identifiers — too low-level for the real audience. **The refinement
documented here replaces those file-path/metric-string inputs with a curated catalog of
pages + actions, and adds a hybrid "propose new measurement" path so PMs can also ask for
brand-new measurements (catalog-declared `proposed` actions or fully freeform).**

Objective: collapse steps 1 and 2 into one portal action a non-technical PM can drive. The
PM picks an action from the catalog; the portal fires the repo's ADW pipeline (by creating
an `adw:zte`-labeled GitHub issue) to wire the product code AND create the first draft
config card in a single auto-merged PR. After merge, the existing portal Edit form refines
the card. Close the typed-link gap platform-wide with a static guard, and extend it to
bidirectional catalog ↔ code drift checks so the catalog stays honest.

## 2. Approach & Changes

### Division of labor
- **Catalog** (`experiments/catalog.yml`) is the source of truth for what's available to A/B
  test. Engineers curate it; the validator cross-checks it against code.
- **Portal** owns identity, uniqueness, and the collaborator gate (the things that need live
  GitHub state at submit-time). It reads the catalog at sign-in and **fails closed** when
  it's missing or malformed (no fallback to file-path inputs).
- **The composed issue body** owns the contract — three or four mandatory deliverables
  depending on template, explicit file paths resolved from the catalog, the literal draft
  card to drop in, pinned literal strings, acceptance criteria.
- **ADW** owns the mechanics — driven by the issue body and the recipe file. The recipe
  carries the heavy detail (Dashboard.tsx pattern, NewAssessment.tsx pattern, validate step,
  draft-card template, UX-scenario rules, design-system enforcement, template-specific
  insertion patterns) so the body stays scannable and the recipe stays maintainable.

### Files

#### `experiments/catalog.yml` + `experiments/catalog.schema.json` (new)
The PM-facing catalog. Page-nested actions; each action declares the metric it fires (or
*would* fire). Key fields per action:
- `metric.key` — snake_case identifier passed to `trackEvent('<key>')`.
- `metric.fires_in` — file path where the trackEvent lives.
- `metric.status` — `instrumented` (live in code) or `proposed` (catalog declares the
  opportunity; code doesn't fire it yet — Template B wires it).
- `metric.handler_hint` — one sentence the build agent uses to locate the handler. Converts
  Template B's task from "creative" to "mechanical".
- `experimentable` per page — hides routes like Login/Admin from the picker without deleting
  them from the catalog's drift coverage.

#### `portal/src/lib/github.ts`
Helpers (reusing the existing `gh<T>()` wrapper):
- `createIssue(token, { title, body, labels })` — single create-with-label call triggers ADW.
- `getRepoPermissions(token)` → `{ push }` — gates the CTA on collaborator status.
- `fetchCatalog(token?)` — loads + parses `experiments/catalog.yml`; throws on any failure
  (the App turns the error into the fail-closed banner).

#### `portal/src/lib/yaml.ts` — `parseCatalog`
Shape-validates the loaded YAML so a malformed catalog at runtime fails with a clear
"a page is missing id/title/actions" message instead of crashing on a downstream property
access. Authoritative validation is the JSON Schema in CI.

#### `portal/src/types.ts`
`Catalog`, `CatalogPage`, `CatalogAction`, `CatalogMetric`, `MetricStatus` — mirror the
schema.

#### `portal/src/lib/adwIssue.ts` — three-template composer
`composeAdwIssue(payload)` → `{ title, body, draft, humanSummary, templateLabel }`. Pure.
- **TEMPLATE A** — existing instrumented action (3 deliverables; verifies the trackEvent is
  there, doesn't add it).
- **TEMPLATE B** — catalog-declared proposed action (4 deliverables; ADW reads the
  `handler_hint`, inserts the trackEvent at the named anchor, flips status
  `proposed` → `instrumented`).
- **TEMPLATE C** — freeform brand-new measurement (4 deliverables; ADW names the handler
  choice in the PR description for human review, runs a duplicate-grep before inserting,
  adds a new catalog row).
- `buildHumanSummary(payload)` — templated 3-sentence preview the PM sees by default. No
  LLM call; sourced from the picked catalog row + form values.

All three templates keep the existing string-byte-identity acceptance criteria + the
literal draft YAML embed + the design-system + UX-scenario rules.

#### `portal/src/components/CreateWithAI.tsx` — catalog-driven form
Built strictly from existing design-system recipes (per CLAUDE.md + the `design-system`
skill). Concrete recipe mapping:
- **Action picker** — `<select>` (`select` recipe) with `<optgroup>` per page. Synthetic
  "Propose a new measurement…" option. Below the select, a `caption` line shows the picked
  action's description plus a `pill` (`pill-running` "Live" or `pill-draft` "Not live yet").
- **Hybrid propose-new sub-form** — nested `card card-pad` block; mode toggle is two
  `btn-sm` (`btn-primary` active / `btn-secondary` inactive); freeform branch shows
  `banner banner-warn` (new amber recipe added to `styles.css`) explaining the human-review
  expectation; existing-proposed branch shows `banner-ok` reassuring the PM Claude will
  wire it mechanically. Includes a client-side **dedup warning** when the freeform metric
  key collides verbatim with an existing catalog row.
- **Advanced override** — collapsed by default, `btn-ghost btn-sm` toggle revealing a
  page-picker `<select>`. Defaults to the action's page; only matters for cross-page funnels
  (e.g. Dashboard CTA → NewAssessment conversion).
- **Templated preview** — default view is the `humanSummary` rendered inside a nested
  `card card-pad` with a small **AI-attribution chip** in the header (`chip-ai` recipe added
  to `styles.css` — `brand-50` background + `brand-700` text + inline sparkles SVG, mirroring
  the design system's mandatory AI provenance pattern). A `btn-ghost btn-sm` toggle reveals
  the raw composed body inside a `<pre>` for engineering audit.
- **Other fields** — name, treatment description (textarea), roles checkboxes, tenants CSV,
  hypothesis — use existing `field` / `label` / `input` / `textarea` / `grid-2` recipes.
- **No hardcoded palette values.** All colors via `var(--brand-*)`, `var(--slate-*)`,
  `var(--amber-*)`, `var(--emerald-*)`, `var(--red-*)`. No inline hex; no `rgb()`.
- **Fail-closed** — when catalog load fails, the form is replaced by a `banner-error` block
  asking an engineer to fix `experiments/catalog.yml`.

#### `portal/src/components/ui.tsx`
`Banner` gains a `warn` kind (amber). `AiChip` component renders the inline-SVG sparkles + AI
label for the design system's AI-attribution pattern.

#### `portal/src/styles.css`
Two new recipes (added — not inlined):
- `banner-warn` — amber soft-tinted banner.
- `chip-ai` — the AI-provenance chip with a tiny embedded sparkles SVG.

#### `portal/src/App.tsx`
Adds the `'ai'` view, loads the catalog on sign-in, shows the fail-closed banner when
loading fails. The collaborator gate (`getRepoPermissions().push`) stays on the
dashboard CTA.

#### `portal/src/components/Dashboard.tsx`
**Create with AI** primary CTA next to the now-secondary `+ New experiment`. The existing
config-only authoring + Edit flows are untouched.

#### `scripts/experiments.mjs` — dead-experiment guard + catalog drift
Two layers. Layer 1 (the original): every `experiments/<key>.yml` must have its key fire in
`useVariant` and its primary metric in `trackEvent` somewhere under `client/src`. Layer 2
(new): bidirectional catalog ↔ code checks:
- **catalog → code (forward):** every `metric.status: instrumented` MUST have its literal in
  its `fires_in` file (per-file `hasLiteralCall`) → **error**.
- **catalog → code (proposed-stale):** `status: proposed` whose literal already exists in
  code → **warning** (flip to `instrumented`).
- **code → catalog (reverse):** every `trackEvent('X')` literal in `client/src` SHOULD have
  a catalog action → **warning**. Encourages engineers to publish new metrics for PM use.
- **page.file / metric.fires_in MUST exist** on disk → **error**.

Scoped so:
- The current `main` keeps passing — `assessment_created` is wired AND in the catalog; the
  unwired `analyze_clicked` is in the catalog as `proposed` (not stale), so the reverse
  check produces only the existing dashboard-cta secondary warning.
- Autonomous ADW PRs stay green for drafts (warnings only); the human's draft→running Edit
  PR is the gate that turns warnings into errors, protecting the live flip while keeping
  ADW's PR hands-off.

#### `specs/adw/RECIPE-new-experiment.md`
Updated with TEMPLATE A/B/C subsections. Each template branch tells ADW exactly what to
add: A verifies the existing trackEvent; B reads `handler_hint` and inserts at the named
anchor; C runs a pre-write duplicate grep, names the handler in the PR description, and
appends a catalog row.

## 3. Key Decisions & Rationale

### A. Hand-curated catalog over auto-derive
At this scale (1 wired metric, monthly experiment cadence) a YAML file with a CI-enforced
bidirectional drift check is dramatically cheaper than agreeing on code annotations + a
derive script. Revisit when shipping 5+ experiments per month.

### B. One action-centric picker (vs. two page+metric pickers)
"What does the user do?" matches the PM mental model. Each catalog row bundles the page,
file paths, and metric into one choice — removing the v1 "wires only half" failure class
from the PM's surface. The cross-page case is supported via a default-collapsed
"where does the change appear?" override, so the rare exception doesn't push complexity onto
the common case.

### C. Hybrid propose-new (catalog `proposed` + freeform fallback)
- The **proposed** sub-picker keeps PM proposals constrained to what engineers pre-declared
  in the catalog (with handler_hint as the safety pin). This is the *recommended* path.
- The **freeform** fallback lets PMs propose truly novel measurements without engineer
  pre-work, at the cost of some PR-review attention on the handler choice. Recipe instructs
  ADW to name the chosen handler in the PR description; the per-file forward drift check
  confirms the new trackEvent landed in the named file. The PM sees a clear "engineering
  reviews this before merge" banner.

### D. First card = `status: draft`, 50/50 (unchanged)
Reasoning grounded in `scripts/experiments.mjs:97`: the audience-overlap scan is gated on
`status === 'running'`. A draft card is excluded entirely, making the new card's validity
*independent of the rest of the registry*. Combined with `assignVariant` returning `null`
for non-running cards, the auto-merged PR is provably inert — no user sees a behavior
change until a human flips the card to running via the existing Edit form. This pushes the
only validation that depends on global state out of the autonomous PR and into the
human-driven Edit PR.

### E. Static dead-experiment guard + bidirectional catalog drift
Without them, the entire feature can produce a green, merged, dead experiment — the worst
kind of failure because it's invisible. The catalog cross-checks extend the same logic to
the catalog itself: it can't lie about what's instrumented. Bidirectionality makes the
catalog stay honest as the codebase grows.

### F. Templated human summary, raw body opt-in
PMs see a templated 3-sentence summary by default — *what the test will change, how success
is measured, who sees it.* The technical brief is one click away for the rare PM who wants
it (or for engineering audit). No LLM call; the summary is built from the catalog row + form
values for predictability.

### G. Fail-closed when catalog absent
Silently falling back to file-path pickers would reintroduce the v1 problem. Better to
make the catalog the contract and surface its absence loudly.

### H. Auto-merge stays (existing ZTE behavior), made safe by draft + per-file drift
`adw_ship.py` squash-merges autonomously when required checks (`quality`, `e2e`, `docker`,
`Analyze (javascript-typescript)`, `experiments`, optionally `ux`) go green. Draft + the
per-file forward catalog check together mean the merged PR can't go live AND can't lie
about being instrumented.

### I. Collaborator gate on the portal CTA
The `adw-zte.yml` workflow gates on `author_association ∈ {OWNER, MEMBER, COLLABORATOR}`,
so a non-collaborator's issue is silently ignored. The portal mirrors the gate client-side
via `GET /repos/{owner}/{repo}` `permissions.push` — same signal the server uses for
results auth — so a non-collaborator never sees the CTA.

### J. Design system is the visual contract
Per CLAUDE.md, the `design-system` skill is invoked before any UI change. The form reuses
existing recipes (`card`, `btn-*`, `input`, `select`, `textarea`, `label`, `field`, `pill`,
`chip`, `banner`); two new recipes (`banner-warn`, `chip-ai`) are added to `styles.css`
because they fill gaps the design system already implies (the amber preliminary-banner and
the mandatory AI-attribution chip). No hex/rgb literals in components.

## 4. Verification

- **Guard + catalog cross-checks, no regressions on `main`:**
  `node scripts/experiments.mjs validate` → exit 0; one warning (the `analyze_clicked`
  secondary metric on `dashboard-cta`, which is intentionally still uninstrumented). The
  catalog declares `analyze_clicked` as `status: proposed` on ReviewWorkspace, which keeps
  the reverse-direction check quiet.
- **Catalog catches instrumented-but-missing-literal (forward, error):** flipping a
  catalog action's `metric.key` to a nonexistent string produced two errors (one per row
  pointing at the broken metric) and exit 1. Verified.
- **Catalog catches proposed-but-already-fires (stale, warning):** flipping the
  instrumented `assessment_created` row to `status: proposed` produced the expected stale
  warning while still exiting 0. Verified.
- **Catalog catches code-without-catalog (reverse, warning):** removing the catalog row
  for an instrumented metric produced the reverse-direction warning. Verified.
- **Portal typecheck + build:** `cd portal && npm run typecheck && npm run build` → clean.
- **Design-system audit:** `grep -E '#[0-9a-fA-F]{3,8}|rgb\(' portal/src/components/CreateWithAI.tsx`
  → zero hits. All colors go through `var(--*)` tokens. New recipes `banner-warn` +
  `chip-ai` defined in `portal/src/styles.css` (not inlined). `AiChip` carries the
  mandatory AI-attribution per design-system/DESIGN_SYSTEM.md §AI ATTRIBUTION.
- **End-to-end (live, user-driven, post-merge):** sign into the deployed portal, click
  "Create with AI"; verify the picker shows experimentable pages only (Login / Admin / etc.
  are hidden); pick the instrumented `start-new-assessment` action for a Template A run;
  pick the proposed `click-analyze` action for a Template B run; switch to the freeform
  sub-form for a Template C run; preview the human summary AND the technical brief; submit;
  confirm ADW opens the expected PR set (3 / 4 / 4 artifacts respectively), goes green on
  all required checks (including the catalog drift checks), and auto-merges. The new
  experiment appears on the dashboard; the Edit form refines it.

## 5. Known limitations / follow-ups

- **The guard checks the experiment key and primary metric literals**, not the freeform
  `=== 'treatment'` comparison or the variant key string in code; the recipe + issue
  acceptance criteria pin the `treatment` literal. A future tightening could grep for
  `<variantString>` literals near each `useVariant('<key>')` site.
- **The recipe is repo-local prose**, not a typed contract. A future improvement would
  express the same invariants as a typed `defineExperiment(key, variants, metrics)` builder
  that the build agent could call from code — eliminating the string-drift class entirely.
- **A non-technical user could still create an issue outside the portal**; the
  `adw-zte.yml` author gate remains the real control. The portal gate just prevents the
  confusing silent no-op for legitimate users without push access.
- **Template C handler-choice risk** is mitigated by (a) the recipe's "name it in the PR
  description" rule, (b) the per-file forward drift check (trackEvent must appear in the
  named `fires_in` file), and (c) the freeform UI's amber banner setting expectations of
  review. A semantically-wrong handler in the *right file* can still ship; the auto-merge
  → human-flips-to-running path is the ultimate safety (a wrong metric won't accrue
  conversions for the live flip, and the human will notice before flipping
  `status: running`).
- **No semantic dedup for proposed metric keys.** The portal warns when the suggested key
  collides verbatim with an existing catalog row; near-duplicates
  (`assessment_started` vs `assessment_create`) still slip through.
- **Page-creation is out of scope.** A brand-new page is a routing + code change, not
  catalog-shaped. The portal hides non-`experimentable` pages; adding new pages remains a
  normal engineering workflow.
- **The catalog's `experimentable: false` flag has no expiration**, so a page that becomes
  experiment-worthy later won't be surfaced automatically. A follow-up could add a
  date-based "stale catalog" warning.
- Duplicate issues from the user double-clicking aren't deduped by the workflow's
  concurrency key (which serializes runs of the *same* issue, not distinct issues for the
  same experiment). The portal's submit button disables during the in-flight POST and
  duplicate-key pre-flight catches the second click after the first issue's PR opens; in the
  narrow race window between, the validator's duplicate-key check is the backstop.
