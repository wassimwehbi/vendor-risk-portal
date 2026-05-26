# Spec — Bug: 'Date submitted' field overflows / mis-aligns on the New Assessment form (mobile)

- **Status:** Draft
- **Branch:** HEAD (worktree 437ad919)
- **Location:** `client/src/index.css`
- **Related docs:** `specs/0005-responsive-mobile-layout.md`, `client/src/pages/NewAssessment.tsx`

## Problem / Objective

### Problem Statement

On the **New Assessment** page, the `<input type="date" className="input" />` (line 102 of `client/src/pages/NewAssessment.tsx`) renders inconsistently with the other form inputs on iOS Safari and other narrow viewports:

- The date value (e.g. `May 26, 2026`) is **center-aligned**, while sibling fields (*Vendor name*, *Questionnaire type*) are left-aligned.
- The native date control **overflows** the card on narrow mobile viewports because WebKit's built-in calendar picker indicator and date-value area do not respect the shared `.input` width/padding constraints.

### Steps to Reproduce

1. Open the app on iOS Safari (or Chrome/Firefox at ≤390px viewport width).
2. Navigate to **New assessment**.
3. Observe the **Date submitted** field — the date value is centered and the control may overflow the card boundaries.

### Root Cause Analysis

WebKit (Safari/iOS) renders `<input type="date">` using an internal shadow DOM. The displayed date text lives inside a `::- webkit-date-and-time-value` pseudo-element which **defaults to `text-align: center`**, overriding the host element's inherited alignment. Additionally, the calendar picker indicator (`::- webkit-calendar-picker-indicator`) is positioned inside the input's padding box and can cause the visible date text to be pushed or the control to visually overflow on narrow widths when no explicit `width: 100%` + `box-sizing: border-box` constraint is enforced at the pseudo-element level.

The `.input` utility in `client/src/index.css` does not have any WebKit date-input normalisation, so the shared styling is partially ignored by the browser's native date widget.

## Approach & Changes

The fix is **CSS-only, in `client/src/index.css`**. No TypeScript, no JSX, no new packages.

- **`client/src/index.css`** — add two targeted rules inside the `@layer components` block (or as a standalone block after it) to normalise WebKit date input rendering:
  1. `input[type="date"].input::-webkit-date-and-time-value` → `text-align: left` — forces the date text to be left-aligned inside the shadow pseudo-element, matching sibling inputs.
  2. `input[type="date"].input::-webkit-calendar-picker-indicator` → `margin-left: auto` / `flex-shrink: 0` — keeps the picker icon at the right edge and prevents it from displacing the text.

No changes to `NewAssessment.tsx` are needed: the element already carries `className="input"` which is the correct hook for the new rules.

### New Files

- `.claude/commands/e2e/test_date_input_alignment.md` — E2E test file (created as a task below, not during planning).

### Step by Step Tasks

#### 1. Add WebKit date-input normalisation to `client/src/index.css`

- Open `client/src/index.css`.
- After the closing `}` of the `.input` rule inside `@layer components`, add a plain (non-`@apply`) CSS block:

```css
/* Normalise WebKit date input: left-align the displayed value and pin the
   calendar icon to the right so it never displaces or overflows the text. */
input[type="date"].input::-webkit-date-and-time-value {
  text-align: left;
}
input[type="date"].input::-webkit-calendar-picker-indicator {
  margin-left: auto;
  flex-shrink: 0;
  cursor: pointer;
}
```

- These rules are scoped to `.input`-classed date inputs so they cannot affect any other component.

#### 2. Create E2E test file for date input alignment

- Read `.claude/commands/test_e2e.md` and `.claude/commands/e2e/` (look at `smoke.spec.ts` under `e2e/` for the Playwright pattern used in this project).
- Create `.claude/commands/e2e/test_date_input_alignment.md` that:
  - Signs in as a developer analyst.
  - Navigates to `/new`.
  - At viewport 390×844 (iPhone 14 Pro), checks that the Date submitted input is visible, has no horizontal overflow beyond the card, and that its text-align is `left` (via `evaluate` on the input's computed style or the shadow pseudo-element style).
  - Takes a screenshot of the form at mobile viewport to prove correct rendering.
  - Uses the minimal set of steps and one screenshot.

#### 3. Run verification commands

- Execute all commands listed in the **Verification** section below in order and confirm all pass.

## Key Decisions & Rationale

- **CSS-only fix** — the root cause is entirely in the browser's rendering of the `::- webkit-date-and-time-value` pseudo-element. Fixing it at the CSS layer is the minimal, correct, and zero-regression approach. Touching JSX (e.g. adding an inline `style`) would work around the symptom but bypass the shared `.input` design system.
- **Scoped selector (`input[type="date"].input`)** — the rules apply only to inputs that carry the `.input` class and are `type="date"`, so the fix is invisible to every other component. No risk of unintended side-effects on text, select, or file inputs.
- **No `appearance: none`** — removing the native date picker widget entirely would fix alignment but at the cost of breaking the calendar pop-up on mobile, which is the primary UX affordance for date entry. We preserve the native widget and only normalise its inner alignment.
- **No new dependency** — a pure CSS fix requires no npm package and keeps the bundle unchanged.

## Verification

Reproduce the bug before the fix: open the app at 390px wide, go to New Assessment, observe the date field centering its value. After applying the fix, the same field shows left-aligned text with no overflow.

- `npm run check` — Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` — Server + client TypeScript type checks
- `npm run test` — Server + client unit tests
- `npm run build` — Client production build
- Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_date_input_alignment.md` to validate date field alignment at mobile viewport.

## Known Limitations / Follow-ups

- The fix targets WebKit (`::- webkit-*` pseudo-elements). Firefox uses a different internal implementation; however Firefox on iOS uses WebKit (mandated by Apple), so the affected platform (iOS Safari) is fully covered. Firefox on desktop renders `type="date"` natively and already left-aligns the value, so no additional rule is needed.
- If a future refactor removes the `.input` class from the date field, the scoped CSS rule will silently stop applying. The E2E test will catch this regression.
