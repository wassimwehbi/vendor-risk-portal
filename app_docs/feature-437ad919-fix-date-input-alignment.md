# Fix: Date Input Alignment on Mobile (New Assessment Form)

**ADW ID:** 437ad919
**Date:** 2026-05-26
**Plan-Spec:** `specs/adw/issue-18-adw-437ad919-fix-date-input-alignment-plan.md`

## Overview

On iOS Safari and narrow viewports (≤390px), the "Date submitted" field on the New Assessment form rendered with center-aligned text and sometimes overflowed the card boundary — inconsistent with sibling fields. A targeted CSS-only fix normalises WebKit's internal date input pseudo-elements so the field matches the rest of the `.input` design system.

## What Was Built

- WebKit date input normalisation rules added to the global stylesheet
- Left-alignment of the date value text inside the shadow DOM pseudo-element (`::- webkit-date-and-time-value`)
- Calendar picker icon pinned to the right edge via `margin-left: auto` and `flex-shrink: 0` to prevent overflow
- E2E test command file for validating date field alignment at mobile viewport (`390×844`)

## Technical Implementation

### Files Modified

- `client/src/index.css`: Added two scoped WebKit pseudo-element rules after the `@layer components` block to normalise date input rendering
- `.claude/commands/e2e/test_date_input_alignment.md`: New E2E test file that validates alignment and overflow at mobile viewport using Playwright

### Key Changes

- **`input[type="date"].input::-webkit-date-and-time-value { text-align: left; }`** — overrides WebKit's default `center` alignment for the displayed date text inside the native date widget's shadow DOM
- **`input[type="date"].input::-webkit-calendar-picker-indicator { margin-left: auto; flex-shrink: 0; cursor: pointer; }`** — pins the calendar picker icon to the right edge, preventing it from displacing or overflowing the date text on narrow widths
- Rules are scoped to `input[type="date"].input` so they only affect date inputs carrying the shared `.input` class — no risk of side-effects on text, select, or file inputs
- No changes to `NewAssessment.tsx` — the element already uses `className="input"`, making it the correct target for the new rules
- Native date picker widget is preserved; `appearance: none` was deliberately avoided to keep the calendar pop-up functional on mobile

## How to Use

The fix is transparent to users and developers. No configuration is needed.

1. Open the app on iOS Safari or any browser at ≤390px viewport width.
2. Navigate to **New assessment**.
3. The **Date submitted** field now displays left-aligned text, matching the *Vendor name* and *Questionnaire type* fields.
4. The calendar picker icon sits flush at the right edge without overflowing the card.

## Configuration

No configuration required. The fix applies automatically to any `<input type="date" className="input" />` element in the app.

## Testing

- `npm run check` — Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` — Server + client TypeScript type checks
- `npm run test` — Server + client unit tests
- `npm run build` — Client production build (runs `tsc --noEmit && vite build`)
- E2E: read `.claude/commands/test_e2e.md`, then execute `.claude/commands/e2e/test_date_input_alignment.md` — validates date field is visible, left-aligned, and not overflowing the card at 390×844 viewport

## Notes

- The fix targets WebKit (`::- webkit-*`) pseudo-elements. Firefox on desktop already left-aligns `type="date"` natively. Firefox on iOS uses WebKit (Apple requirement), so the primary affected platform is fully covered.
- If a future refactor removes the `.input` class from the date field, the scoped CSS rule will silently stop applying. The E2E test will catch this regression.
- AI output is preliminary; the final vendor-risk decision is always made by a human analyst.
