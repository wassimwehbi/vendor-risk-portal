# Spec — Bug: 'Date submitted' field overflows / mis-aligns on the New Assessment form (mobile)

- **Status:** Draft
- **Branch:** bug-issue-18-adw-865a8199-fix-date-input-alignment
- **Location:** `client/src/index.css`
- **Related docs:** `specs/0005-responsive-mobile-layout.md`, `specs/0001-vendor-risk-questionnaire-portal.md`

## Problem / Objective

### Problem Statement
On the **New Assessment** page, the `<input type="date">` element using the shared `.input` utility class renders inconsistently with sibling inputs (`<input type="text">` and `<select>`). The date value is center-aligned rather than left-aligned, and the native date control overflows visually within the form card on narrow mobile viewports (iOS Safari).

### Steps to Reproduce
1. Open the app on a mobile browser (iOS Safari or narrow-viewport Chromium DevTools).
2. Navigate to **New Assessment**.
3. Observe the **Date submitted** field — the date value (`May 26, 2026`) is center-aligned; *Vendor name* and *Questionnaire type* inputs are left-aligned.
4. Also observe that the native date widget can overflow the card boundary on very narrow viewports.

### Root Cause Analysis
The `.input` utility in `client/src/index.css` is:

```css
.input {
  @apply w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm
         focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25;
}
```

This class does **not** set `text-align`, which is fine for `type="text"` and `<select>` because browsers default those to left-aligned. However, WebKit/Safari renders `type="date"` via a shadow DOM whose inner `::-webkit-date-and-time-value` pseudo-element uses `text-align: center` by default. Because this pseudo-element lives inside the browser's shadow DOM, it overrides the inherited text alignment.

Additionally, the native date picker icon (`::-webkit-calendar-picker-indicator`) is not accounted for in the padding, which can cause the date value text to be clipped or overflow the visible padding area on narrow screens.

No date-specific CSS overrides exist anywhere in the codebase today.

## Approach & Changes

Minimal CSS-only fix: extend `client/src/index.css` with targeted overrides that normalize `input[type="date"]` to match the rest of the `.input` form controls — without touching any TypeScript, any component file, or any other utility class.

**Why CSS-only?**
- The `NewAssessment.tsx` component correctly applies the `.input` class; the class is the right abstraction. The fix belongs in the stylesheet where `.input` is defined.
- Keeping the fix in `index.css` means every future `type="date"` in the app automatically inherits the correct behaviour.

**Files and why they matter:**
- `client/src/index.css` — defines the `.input` shared utility; date-input normalisation goes here, adjacent to the existing class.

### New Files
- `.claude/commands/e2e/test_date_input_alignment.md` — E2E test instructions to validate the fix visually.

### Step by Step Tasks

#### 1. Read the current `.input` definition and surrounding CSS
- Open `client/src/index.css` and read the full file to understand what utilities already exist and where to insert the new rules without breaking anything.

#### 2. Add date-input normalisation rules to `client/src/index.css`
Add the following block **immediately after** the `.input` rule (before `.label` or the next utility):

```css
/* Normalize native date input to match .input sibling controls */
input[type="date"].input {
  text-align: left;
}
input[type="date"].input::-webkit-date-and-time-value {
  text-align: left;
}
input[type="date"].input::-webkit-calendar-picker-indicator {
  opacity: 0.6;
  cursor: pointer;
}
```

- `text-align: left` on the element itself handles Firefox and any non-WebKit browsers that respect it directly.
- `::-webkit-date-and-time-value { text-align: left }` overrides WebKit/Safari's default center-alignment inside the shadow DOM.
- `::-webkit-calendar-picker-indicator` is styled to be visible but unobtrusive and non-overflowing; giving it explicit `opacity` and `cursor` is enough to prevent it from pushing content out on narrow viewports without needing to hide it.
- No `appearance: none` — that would destroy the native date picker affordance; we normalise only what causes the reported symptoms.

#### 3. Read `.claude/commands/test_e2e.md`, then create `.claude/commands/e2e/test_date_input_alignment.md`
- Read `.claude/commands/test_e2e.md` to understand the E2E test file format.
- Create `.claude/commands/e2e/test_date_input_alignment.md` with a focused test that:
  1. Navigates to the New Assessment page.
  2. Observes the **Date submitted** input and verifies it is visually consistent (left-aligned) with the other inputs.
  3. Takes a screenshot scoped to the form card on a narrow (375 px) viewport.
  4. Verifies no overflow outside the card boundary.
  - Keep the test minimal: navigation + viewport resize + one screenshot proving alignment is correct.

#### 4. Run Verification commands
Execute all commands listed in the **Verification** section below and confirm zero failures.

## Key Decisions & Rationale

**Why target `input[type="date"].input` rather than `input[type="date"]` alone?**
Using `.input` as a compound selector means the fix only applies to elements that explicitly opt into the design system's form control style — it won't accidentally override date inputs rendered outside the portal (e.g. inside a future third-party widget). This is the minimal-blast-radius approach.

**Why not change `NewAssessment.tsx`?**
Adding an inline `style={{ textAlign: 'left' }}` to the component would fix one instance but leave all future `type="date"` uses unprotected. The bug is a stylesheet gap, not a component authoring mistake.

**Why not use `appearance: none`?**
Removing the native date picker affordance degrades usability, especially on mobile where keyboard date entry is error-prone. The symptoms (centre-alignment and overflow) are fully addressed by the two pseudo-element rules without needing to replace the native widget.

## Verification

Reproduce before fix: open New Assessment on a 375 px viewport — the Date submitted value is centre-aligned relative to *Vendor name*. After applying the CSS, the value is left-aligned and consistent.

- Read `.claude/commands/test_e2e.md`, then read and execute your new E2E test `.claude/commands/e2e/test_date_input_alignment.md` to validate this functionality works.
- `npm run check` — Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` — Server + client TypeScript type checks
- `npm run test` — Server + client unit tests
- `npm run build` — Client production build

## Known Limitations / Follow-ups

- The `::-webkit-date-and-time-value` pseudo-element is non-standard and only available in WebKit/Blink. Firefox uses its own internal rendering but respects `text-align` on the element itself, so the `input[type="date"].input { text-align: left }` rule covers it.
- If a future iteration replaces the native date input with a custom calendar component (e.g. react-day-picker), these CSS rules become harmless no-ops and can be removed then.
- The fix does not address the visual weight of the calendar-picker icon on very dark themes — noted as a cosmetic follow-up only, not a blocker.
