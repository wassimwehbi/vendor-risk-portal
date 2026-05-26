# Spec — Patch: Fix date input overflow on iOS Safari (pointer:coarse)

- **Status:** Draft
- **Branch:** patch-adw-date-submitted-fix-ios-overflow
- **Location:** `client/src/index.css`
- **Related docs:** `specs/adw/issue-18-adw-865a8199-fix-date-input-alignment-plan.md`, `specs/0005-responsive-mobile-layout.md`

## Problem / Objective
**Original Spec:** `specs/adw/issue-18-adw-865a8199-fix-date-input-alignment-plan.md`
**Issue:** On iOS Safari the `<input type="date">` in the New Assessment form overflows horizontally outside the form card. PR #21 only added `text-align` rules which do not affect box sizing — the underlying cause is that grid items default to `min-width: auto`, which allows the native iOS date control's large intrinsic width to exceed its grid track.
**Solution:** Add a `@media (pointer: coarse)` block that sets `appearance: none`, `min-width: 0`, and `max-width: 100%` on `input[type='date'].input`. This releases the grid item's minimum-size constraint so `width: 100%` from `.input` can take effect. `appearance: none` is required for iOS to honour explicit sizing; the native wheel picker still opens on tap.

## Approach & Changes
### Files to Modify
- `client/src/index.css` — add one `@media (pointer: coarse)` block after the existing date-input pseudo-element rules (lines 33–43)

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `@media (pointer: coarse)` block to `client/src/index.css`
- Append the following block immediately after the existing `input[type='date'].input::-webkit-calendar-picker-indicator` rule (after line 43), still inside `@layer components`:

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

- `appearance: none` causes iOS WebKit to respect explicit `width`/`box-sizing` instead of painting at the native control's intrinsic width.
- `min-width: 0` overrides the grid item's default `min-width: auto`, which is the direct cause of the overflow.
- `max-width: 100%` provides a hard ceiling as a safety net.
- `@media (pointer: coarse)` scopes the rule to touch devices (iOS, Android, iPad) and leaves desktop untouched.

### Step 2: Verify the build passes
- Run the verification commands below to confirm no regressions.

## Key Decisions & Rationale
**Lines of code to change:** 7 (one new CSS block, 6 declarations + media wrapper)
**Risk level:** low
**Testing required:** Client build + typecheck; desktop rendering is unaffected by `pointer: coarse` guard; iOS-specific overflow cannot be validated with headless Playwright/Chromium (Blink does not reproduce the iOS WebKit intrinsic-width behaviour)

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `npm run check` - Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` - Server + client TypeScript type checks
- `npm run test` - Server + client unit tests
- `npm run build` - Client production build

## Known Limitations / Follow-ups
- Automated headless (Playwright/Chromium) and Chrome DevTools emulation use Blink and will not reproduce or validate the overflow fix — physical iOS Safari or a real iOS Simulator is required for definitive visual confirmation.
- `appearance: none` removes the native date-picker chrome on touch devices; the wheel picker still opens on tap (iOS behaviour), so usability is preserved.
- PR #21's `text-align` rules are retained; they are harmless and remain correct for non-WebKit browsers.
