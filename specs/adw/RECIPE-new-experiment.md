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
- `experiments/README.md` — lifecycle + CI rules.
- `client/src/pages/Dashboard.tsx` L12–20 — `useVariant` + variant branching (the canonical
  pattern; the comment at L12–14 documents the no-typed-link caveat).
- `client/src/pages/NewAssessment.tsx` L51–52 — `api.trackEvent` at the goal action.
- `client/src/lib/FlagsContext.tsx` — `useVariant` / `useFlag` API.
- `specs/0015-experimentation-platform.md` — platform design.

The issue body contains a **Structured fields** block. Treat every value as **verbatim** — do
not paraphrase keys, metric names, or file paths.

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

In the file named in the issue's `goal-action-file:` field (often a *different* page from the
wiring), find the handler for the goal action described in the issue and fire the conversion.
**Mirror `NewAssessment.tsx` L51–52 exactly** — fire-and-forget, non-blocking, after the
action's primary API call succeeds:

```ts
// A/B conversion signal for the `<key>` experiment (spec 0015). Fire-and-forget.
api.trackEvent('<primary-metric>').catch(() => undefined);
```

**Required string-byte-identity:** `trackEvent('<primary-metric>')` ← the literal must equal
`metrics.primary` in the YAML card.

---

## 4. VALIDATE — `node scripts/experiments.mjs validate`

Run this in your build/test phase (it's a required CI gate; ship does **not** auto-fix the
`experiments` check, so any validation error must be resolved upstream in build/test where
phases auto-iterate).

The script enforces: schema, key == filename, weights sum to 100, no two running
experiments overlapping on the same surface, and the **dead-experiment guard** (spec 0017) —
verifies that `useVariant('<key>')` and `trackEvent('<metrics.primary>')` literals exist under
`client/src`. For a draft these are **warnings**; the human's draft→running Edit PR turns them
into errors, so they must be clean here (don't ship a draft PR whose warnings the running flip
will reject).

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

Open one PR with all three artifacts:
- `experiments/<key>.yml` (new file).
- The `useVariant` branch in the page file.
- The `trackEvent` call in the goal-action file.

If your PR is missing any of the three, it is incomplete — the planner should produce all
three as explicit tasks in the plan-spec. The reviewer agent must verify the four
string-byte-identity acceptance criteria from the issue before approving.

---

## Failure modes & mitigations (quick reference)

| Failure | What goes wrong | Mitigation |
|---|---|---|
| key/variant string drift | Silently serves control forever, all checks green | Pinned literals here + dead-experiment guard in `experiments.mjs` |
| Wiring without conversion (or vice-versa) | Experiment can't show results / `useVariant` returns control | Three mandatory artifacts; explicit `page-file` vs `goal-action-file` |
| Control-path perturbation | `ux` check goes red, ship aborts to human | Treatment fully flag-gated; control byte-identical |
| Bad YAML schema/weights | `experiments` check red, ship aborts | Use the literal template; run `validate` in build/test |
| Copying live `dashboard-cta.yml` as a "draft example" | Inherits `running` + `weight: 0/100` | Use the literal template in §1; never copy `dashboard-cta.yml` verbatim |
| Unwired secondary metric | Validator warns (draft) / errors (running) | Only declare secondary metrics you'll actually fire; otherwise omit |
