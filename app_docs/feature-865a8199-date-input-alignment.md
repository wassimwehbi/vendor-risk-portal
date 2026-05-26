# Date Input Alignment Fix (Mobile)

**ADW ID:** 865a8199
**Date:** 2026-05-26
**Plan-Spec:** specs/adw/issue-18-adw-865a8199-fix-date-input-alignment-plan.md

## Overview

Fixes a visual inconsistency on the New Assessment form where `<input type="date">` rendered centre-aligned in WebKit/Safari (iOS) while sibling text and select inputs were left-aligned. The fix also prevents the native date control from overflowing the card boundary on narrow (375 px) mobile viewports.

## What Was Built

- CSS-only normalisation rules for `input[type="date"].input` in the shared stylesheet
- WebKit shadow-DOM pseudo-element overrides for `::-webkit-date-and-time-value` and `::-webkit-calendar-picker-indicator`
- E2E test command file (`.claude/commands/e2e/test_date_input_alignment.md`) for validating the fix visually

## Technical Implementation

### Files Modified

- `client/src/index.css`: Three CSS rules added immediately after the `.input` utility definition to normalise date input alignment and calendar-icon behaviour
- `.claude/commands/e2e/test_date_input_alignment.md`: New E2E test instructions for the date input alignment scenario
- `specs/adw/issue-18-adw-865a8199-fix-date-input-alignment-plan.md`: Plan-spec added to the ADW namespace

### Key Changes

- `input[type='date'].input { text-align: left }` — fixes alignment in Firefox and non-WebKit browsers that respect `text-align` directly on the element
- `input[type='date'].input::-webkit-date-and-time-value { text-align: left }` — overrides WebKit/Safari's default `text-align: center` inside the native date shadow DOM
- `input[type='date'].input::-webkit-calendar-picker-indicator { opacity: 0.6; cursor: pointer }` — prevents the calendar icon from causing overflow on narrow viewports without hiding it
- Compound selector `input[type="date"].input` scopes the fix to elements that explicitly use the design-system class, avoiding accidental override of any future third-party date widget
- `appearance: none` was deliberately avoided to preserve the native date-picker affordance on mobile

## How to Use

The fix is transparent to developers and users — no component changes are required.

1. Apply the `.input` class to any `<input type="date">` element as you would any other form control.
2. The date value will render left-aligned, consistent with adjacent `type="text"` and `<select>` controls.
3. The calendar picker icon will be visible but unobtrusive and will not overflow the containing card on viewports as narrow as 375 px.

## Configuration

No configuration required. The fix is applied globally via the shared `client/src/index.css` stylesheet and activates automatically for any `input[type="date"]` that carries the `.input` class.

## Testing

```bash
# Lint + format check
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# Unit tests (server + client)
npm run test

# Production build
npm run build
```

E2E visual validation: run the skill `/e2e:test_date_input_alignment` (or read `.claude/commands/e2e/test_date_input_alignment.md` for manual steps). The test navigates to New Assessment on a 375 px viewport, screenshots the form card, and confirms the Date submitted field is left-aligned.

## Notes

- `::-webkit-date-and-time-value` is a non-standard pseudo-element (WebKit/Blink only). Firefox is covered by the `text-align: left` rule on the element itself.
- If the native date input is ever replaced with a custom calendar component (e.g. react-day-picker), these rules become harmless no-ops and can be removed at that time.
- Calendar-icon visual weight on dark themes is a noted cosmetic follow-up and not addressed by this fix.
