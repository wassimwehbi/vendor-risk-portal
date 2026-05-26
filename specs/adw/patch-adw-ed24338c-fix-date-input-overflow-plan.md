# Spec — Patch: Fix date input overflow on iOS Safari (mobile)

- **Status:** Implemented
- **Branch:** bug-issue-23-adw-ed24338c-fix-date-input-overflow
- **Location:** `client/src/index.css`
- **Related docs:** `specs/adw/issue-18-adw-865a8199-fix-date-input-alignment-plan.md`

## Problem / Objective
**Original Spec:** `specs/adw/issue-18-adw-865a8199-fix-date-input-alignment-plan.md`
**Issue:** On iOS Safari, the `<input type="date">` in the New Assessment form overflows horizontally past the form card's right edge. PR #21 added `text-align` rules but never addressed box sizing — iOS renders the native date control with a large intrinsic `min-width` that overrides `w-full` (`width: 100%`) on grid items whose `min-width` defaults to `auto`.
**Solution:** Add a `@media (pointer: coarse)` block in `client/src/index.css` that sets `-webkit-appearance: none`, `appearance: none`, `min-width: 0`, and `max-width: 100%` on `input[type='date'].input`. This releases the grid item's `min-width: auto` constraint, allows the control to shrink to its track, and makes iOS honour `width: 100%`. The existing `text-align` rules from PR #21 are kept untouched.

## Approach & Changes
### Files to Modify
- `client/src/index.css` — add one `@media (pointer: coarse)` rule block after the existing date-input rules (lines 33–43)

### Implementation Steps

### Step 1: Add `@media (pointer: coarse)` block in `client/src/index.css`
- Insert the following CSS immediately after the existing `input[type='date'].input::-webkit-calendar-picker-indicator` block (after line 43, before `.label`):
  ```css
  @media (pointer: coarse) {
    input[type='date'].input {
      -webkit-appearance: none;
      appearance: none;
      min-width: 0;
      max-width: 100%;
    }
  }
  ```
- `appearance: none` makes iOS respect `width: 100%` + `box-sizing: border-box` instead of painting at its intrinsic native-control width.
- `min-width: 0` releases the CSS grid item's default `min-width: auto` so the element can shrink to fit its track.
- `max-width: 100%` is a safety belt preventing any overflow.
- `@media (pointer: coarse)` scopes the rule to touch devices (phones, tablets) without affecting desktop browsers' native calendar-picker indicator.

## Key Decisions & Rationale
**Lines of code to change:** ~7 (one new CSS block)
**Risk level:** low — change is scoped to `pointer: coarse` devices only; desktop layout and other inputs are unaffected
**Testing required:** Client build (`npm run build`); TypeScript checks pass; visual confirmation on iOS Safari that the date field stays within the card

## Verification
Execute every command in order to validate the patch is complete with zero regressions.

- `npm run check` — Biome lint + format check (run from repo root)
- `npm run typecheck` — Server + client TypeScript type checks
- `npm run test` — Server + client unit tests
- `npm run build` — Client production build; confirms Tailwind/PostCSS processes the new rule without errors

## Known Limitations / Follow-ups
- Automated Playwright/Chromium e2e tests run Blink, not WebKit, so they cannot reproduce or validate the iOS overflow. The definitive verification requires a physical iPhone or iOS Simulator in Safari — treat CI green as a regression gate only, not overflow proof.
- The existing PR #21 `text-align` rules are intentionally kept; they are harmless and correct for non-WebKit environments.
