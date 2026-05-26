# Fix: Date Input Overflow on iOS Safari (Mobile)

**ADW ID:** ed24338c
**Date:** 2026-05-26
**Plan-Spec:** specs/adw/patch-adw-ed24338c-fix-date-input-overflow-plan.md

## Overview

On iOS Safari, the `<input type="date">` in the New Assessment form overflowed horizontally past the form card's right edge. This patch adds a `@media (pointer: coarse)` CSS rule that strips the native iOS date control's intrinsic sizing constraints, allowing it to honour `width: 100%` and remain contained within its parent card.

## Screenshots

N/A

## What Was Built

- A targeted `@media (pointer: coarse)` CSS rule in `client/src/index.css` that suppresses iOS Safari's intrinsic `min-width` on `input[type='date'].input` elements
- `-webkit-appearance: none` / `appearance: none` to make WebKit respect `box-sizing: border-box` and `width: 100%` instead of painting at the native control's intrinsic width
- `min-width: 0` to release the CSS grid item's default `min-width: auto`, allowing the element to shrink to its track
- `max-width: 100%` as a safety belt preventing any overflow

## Technical Implementation

### Files Modified

- `client/src/index.css`: Added one `@media (pointer: coarse)` block (9 lines) immediately after the existing date-input webkit rules to fix iOS Safari date control overflow

### Key Changes

- The fix is scoped exclusively to `pointer: coarse` (touch) devices — desktop browsers and their native calendar-picker indicator are completely unaffected
- `appearance: none` is the root fix: it tells WebKit to drop the native-control intrinsic width and respect the authored `width: 100%` + `box-sizing: border-box` instead
- `min-width: 0` removes the CSS grid item's `min-width: auto` default, which was preventing the date input from shrinking to fit its grid track
- The existing `text-align` rules added in PR #21 are preserved untouched; this patch builds on top of them
- Risk is low — the change is isolated to a single media query and does not affect any other input types or viewport sizes

## How to Use

This fix is transparent to users. On iOS Safari:

1. Open the New Assessment form
2. The date input ("Date Submitted") now stays fully within the form card with no horizontal overflow
3. Tapping the field still opens the native iOS date picker as expected

No user action or configuration is required.

## Configuration

No configuration or environment variables are required. The fix is pure CSS applied automatically at the Tailwind/PostCSS build step.

## Testing

Run these commands in order from the repo root to validate the patch:

```bash
npm run check        # Biome lint + format check
npm run typecheck    # Server + client TypeScript type checks
npm run test         # Server + client unit tests
npm run build        # Client production build — confirms Tailwind/PostCSS processes the new rule without errors
```

For the E2E date-input alignment suite:

```bash
npx playwright test e2e/date-input-alignment.spec.ts
```

> **Note:** Playwright/Chromium E2E tests use the Blink engine, not WebKit, so they cannot reproduce or validate the iOS-specific overflow. CI green is a regression gate only. Definitive confirmation of the overflow fix requires a physical iPhone or iOS Simulator running Safari.

## Notes

- This patch is a follow-up to PR #21 (`specs/adw/issue-18-adw-865a8199-fix-date-input-alignment-plan.md`), which addressed `text-align` alignment but did not resolve the underlying box-sizing issue on iOS Safari.
- The `@media (pointer: coarse)` query is the recommended approach for targeting touch devices in CSS without relying on browser sniffing.
- If future iOS Safari versions change their native date control rendering, this rule may need revisiting, but the properties used (`appearance`, `min-width`, `max-width`) are stable CSS standards.
