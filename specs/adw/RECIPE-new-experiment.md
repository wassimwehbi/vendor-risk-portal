# RECIPE — Wire a brand-new A/B experiment end-to-end

This is the **authoritative mechanical recipe** the ADW build agent must follow when an issue
asks for a new experiment (created via the experiments portal's "Create with AI" flow — see
`specs/0017-adw-experiment-authoring.md` and the umbrella platform spec
`specs/0015-experimentation-platform.md`).

An experiment is **three artifacts in three files** — a YAML card, a `useVariant` branch in a
page, and a `trackEvent` call at a goal action. There is **no typed link** between them: a typo
silently serves control forever and ships green. Follow this recipe exactly to keep them in sync.

---

## 0. Read these first
- `experiments/dashboard-cta.yml` — the YAML shape. **Note: it's `status: running` 0/100; do
  NOT copy verbatim** — use the literal draft template in §1 below.
- `experiments/schema.json` — the validated contract.
- `experiments/catalog.yml` + `experiments/catalog.schema.json` — the PM-facing catalog
  (spec 0017). Templates B and C touch this file.
- `experiments/README.md` — lifecycle + CI rules.
- `client/src/pages/Dashboard.tsx` L12–20 — `useVariant` + variant branching (the canonical
  pattern; the comment at L12–14 documents the no-typed-link caveat).
- `client/src/pages/NewAssessment.tsx` L51–52 — `api.trackEvent` at the goal action.
- `client/src/lib/FlagsContext.tsx` — `useVariant` / `useFlag` API.
- `specs/0015-experimentation-platform.md` — platform design.

The issue body contains a **Structured fields** block. Treat every value as **verbatim** — do
not paraphrase keys, metric names, or file paths.

**Which template is this?** The issue body's first line names it (`Template: A`, `B`, or `C`).
Template determines which §3 you follow:
- **A** (existing instrumented action): only sections 1, 2, 4, 5, 6, 7 — no new event code.
- **B** (catalog-proposed action): adds §3-B (insert trackEvent at the catalog's
  `handler_hint` anchor) and §3-CATALOG (flip status `proposed` → `instrumented`).
- **C** (freeform brand-new measurement): adds §3-C (insert trackEvent with extra discipline)
  and §3-CATALOG (add a new action row to the catalog). Reviewer sign-off on the handler
  choice is expected before merge.

---

## 1. CONFIG CARD — `experiments/<key>.yml` (draft)

Write **exactly this shape**, replacing the bracketed values from the issue's Structured fields
block. Set `tracking_issue` to the **number of the issue you're working on**.

```yaml
# yaml-language-server: $schema=./schema.json
key: <key>                    # MUST equal the filename basename (no .yml)
name: <name>
status: draft                 # do NOT change to running — the human flips it later via the portal
variants:
  - key: control
    weight: 50
  - key: treatment
    weight: 50
surface: <surface>            # optional but recommended; defaults from the page-file basename
targeting:                    # only if the issue specifies roles/tenants
  roles: [<...>]
  tenants: [<...>]
metrics:
  primary: <primary-metric>   # MUST be byte-identical to the trackEvent string in step 3
tracking_issue: <this issue's number>
```

**Why draft + 50/50:** validates without depending on other experiments' state (the
running-only audience-overlap scan is skipped), and `assignVariant` returns `null` for
non-`running` cards — so the treatment branch is dead code until a human flips it via the
portal Edit form. The auto-merge changes nothing user-visible.

---

## 2. PRODUCT WIRING — `useVariant` in `<page-file>`

In the page file named in the issue's `page-file:` field, **mirror `Dashboard.tsx` L12–20
exactly**. The treatment branch must be **fully flag-gated** and the control branch
**byte-identical to today**: no new imports with side effects, no changes to shared markup, no
restructured JSX. With `status: draft` the rendered page must look identical to before — UX
structural + a11y invariants depend on it.

```tsx
import { useVariant } from '../lib/FlagsContext';
// ...inside the component:
// A/B (spec 0015): <key> tests <one-line hypothesis>. The experiment key and the
// 'treatment' literal below MUST match experiments/<key>.yml — there is no typed
// link, so renaming the variant there silently reverts this to control.
const <camelKey>Variant = useVariant('<key>');
const isTreatment = <camelKey>Variant === 'treatment';
// ...in JSX:
{isTreatment ? (
  /* treatment UI — implement the change from "Treatment UI" in the issue */
) : (
  /* control — unchanged */
)}
```

**Required string-byte-identity:** `useVariant('<key>')` ← the literal must equal the YAML
filename basename. The comparison must be against the literal `'treatment'` (matches the YAML
variant key).

---

## 3. CONVERSION EVENT — `api.trackEvent` in `<goal-action-file>`

The required action depends on which template the issue specifies. Read the appropriate
sub-section.

### 3-A. Template A — the action is already instrumented

The catalog says `trackEvent('<primary-metric>')` already fires in `<goal-action-file>`.
**Verify** it's there (do not duplicate it):

```sh
grep "trackEvent('<primary-metric>')" <goal-action-file>
```

If the literal isn't found, treat this as a catalog bug — STOP and comment on the issue. Do
NOT add the trackEvent without confirming with a human; the catalog promised it exists.

### 3-B. Template B — the catalog declared the action, but code doesn't fire it yet

Read the catalog row for `<page-id>/<action-id>` and lift its `handler_hint`. The hint tells
you exactly which handler in `<goal-action-file>` to instrument and where to insert the call.
Treat it as a verbatim instruction — do not improvise an insertion point.

Insert this line at the named anchor, mirroring `NewAssessment.tsx` L51–52:

```ts
// A/B conversion signal for the `<key>` experiment (spec 0015). Fire-and-forget.
api.trackEvent('<primary-metric>').catch(() => undefined);
```

### 3-C. Template C — freeform brand-new measurement

The human asked for a brand-new measurement that doesn't have a catalog row yet. **There is no
engineering review in the merge path** for freeform — the safety chain is the catalog
forward-drift check + draft-first auto-merge + the PM verifying results before they flip the
card to `running`. Extra discipline applies:

1. **Duplicate check.** Before writing:
   ```sh
   grep -r "trackEvent('<primary-metric>')" client/src
   ```
   If the literal already exists, STOP and comment on the issue — the human should re-pick
   the existing measurement from the catalog. Do NOT add a duplicate.
2. **Handler choice.** The issue may or may not include a hint (the `Treatment UI` /
   `handler_hint` lines). Choose the handler that most clearly matches the user-facing action
   in the issue's "Action description". **Name your choice in the PR description** (file +
   function + one-line rationale) — this isn't a gate, but it makes the PR auditable and lets
   the PM cross-check the wiring against the eventual results before flipping the test on. The
   catalog forward-drift check (per-file) is the load-bearing gate: it requires the literal to
   appear in the file the catalog row's `fires_in` names, so a wrong-file insertion fails CI.
3. **Insertion** uses the same pattern as 3-B (mirror `NewAssessment.tsx` L51–52,
   fire-and-forget, after the primary API call resolves).

### 3-CATALOG (Templates B and C) — keep the catalog in sync

The catalog is the PM-facing source of truth and is bidirectionally validated by
`scripts/experiments.mjs`. In the same PR:

- **Template B:** flip `status: proposed` → `status: instrumented` on the catalog action
  identified in the issue (`<page-id>/<action-id>`). The per-file forward drift check will
  confirm `trackEvent('<primary-metric>')` now exists in the named `fires_in` file.
- **Template C:** append a new action under the picked page (`<page-id>`). Use the human's
  action title + description verbatim from the issue; set `metric.key` to `<primary-metric>`,
  `fires_in` to the file you instrumented, `status: instrumented`, and `handler_hint` to a
  one-sentence description of the handler you chose (essential — future PMs picking this row
  via Template B will rely on it).

**Required string-byte-identity (all templates):** `trackEvent('<primary-metric>')` ← the
literal must equal `metrics.primary` in the YAML card and (for B/C) `metric.key` in the
catalog row.

---

## 4. VALIDATE — `node scripts/experiments.mjs validate`

Run this in your build/test phase (it's a required CI gate; ship does **not** auto-fix the
`experiments` check, so any validation error must be resolved upstream in build/test where
phases auto-iterate).

The script enforces: schema, key == filename, weights sum to 100, no two running
experiments overlapping on the same surface, the **dead-experiment guard** (spec 0017) —
verifies that `useVariant('<key>')` and `trackEvent('<metrics.primary>')` literals exist under
`client/src` — AND the **catalog bidirectional drift checks** (spec 0017 refinement):

- `status: instrumented` rows MUST have their `metric.key` literal in their `fires_in` file
  (per-file forward check) — this is an **error**, so Templates B and C must complete the
  trackEvent insertion in the right file before validate is rerun.
- `status: proposed` rows must NOT yet appear in code (stale = warning).
- Every `trackEvent('X')` literal in `client/src` SHOULD have a catalog action — warning, so
  Template C's new row resolves it.
- Every page `file` MUST exist.

For a draft experiment the dead-experiment guard's key/metric checks are **warnings**; the
human's draft→running Edit PR turns them into errors, so they must be clean here (don't ship
a draft PR whose warnings the running flip will reject).

---

## 5. UX TESTING — reuse, don't add

If the experiment lives on an existing route, **do not add a new scenario** to
`e2e/ux/scenarios.ts`. With `status: draft` the route renders identically to today, so the
existing scenario's structural + a11y invariants cover this PR correctly. Only add a new
scenario when the experiment introduces a brand-new route (rare for an experiment).

The PR `ux` check (`.github/workflows/ux-regression.yml`) is **structural + a11y only on
PRs** (`noHorizontalOverflow`, `axeClean`, `noConsoleErrors`, `focusVisibleRing`) — pixel
snapshots are nightly. A flag-gated draft passes naturally; a control-path perturbation will
fail it, so audit any shared imports/markup you touched.

---

## 6. DESIGN SYSTEM — required for UI work

Per `CLAUDE.md`, any UI change is **blocked** without invoking the **`design-system` skill**
(`.claude/skills/design-system/`) and reading `design-system/DESIGN_SYSTEM.md`. For the
treatment branch:
- Reuse the shared recipes — `card` / `btn-*` / `input` / `label` / pills / chips. Never
  hardcode palette values.
- Sentence-case copy. No new emoji.
- Use `BrandMark` for any logo, not text monograms.

---

## 7. PR shape (what gets merged)

The artifact count depends on the template:

| Template | Artifacts | Notes |
|---|---|---|
| **A** | card + wiring | trackEvent is already in the goal-action file — verified, not added |
| **B** | card + wiring + new trackEvent + catalog status flip | the catalog `handler_hint` is the load-bearing pointer |
| **C** | card + wiring + new trackEvent + new catalog row | name the handler choice in the PR description |

If your PR is missing any required artifact for its template, it is incomplete — the planner
should produce each one as an explicit task in the plan-spec. The reviewer agent must verify
the string-byte-identity acceptance criteria from the issue before approving (and for Template
C, the reviewer should sanity-check the handler choice named in the PR description).

---

## Failure modes & mitigations (quick reference)

| Failure | What goes wrong | Mitigation |
|---|---|---|
| key/variant string drift | Silently serves control forever, all checks green | Pinned literals here + dead-experiment guard in `experiments.mjs` |
| Wiring without conversion (or vice-versa) | Experiment can't show results / `useVariant` returns control | Mandatory artifacts per template; explicit `page-file` vs `goal-action-file` from the catalog |
| Control-path perturbation | `ux` check goes red, ship aborts to human | Treatment fully flag-gated; control byte-identical |
| Bad YAML schema/weights | `experiments` check red, ship aborts | Use the literal template; run `validate` in build/test |
| Copying live `dashboard-cta.yml` as a "draft example" | Inherits `running` + `weight: 0/100` | Use the literal template in §1; never copy `dashboard-cta.yml` verbatim |
| Unwired secondary metric | Validator warns (draft) / errors (running) | Only declare secondary metrics you'll actually fire; otherwise omit |
| Template B: instrumented status but no literal (forward drift) | Catalog promises a metric the code doesn't deliver | Per-file forward check errors in CI — finish the trackEvent insertion before validate |
| Template C: handler choice wrong | Conversion counts the wrong action; experiment results are misleading | Name the handler in PR description; reviewer signs off before merge |
| Template C: duplicate metric | Two metrics for one concept = split-traffic stats | Pre-write `grep -r "trackEvent('<key>')" client/src`; stop on hit |
| Code-without-catalog | New `trackEvent` not surfaced to PMs in portal | Reverse-direction warning in CI; engineer adds the catalog row in a follow-up |
