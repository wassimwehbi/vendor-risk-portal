# E2E Test — Assessment Grid: Tooltip + Resizable Columns

Verify that truncated cells in the control-by-control grid show tooltips on hover/focus/tap,
and that column resize handles work correctly with mouse drag, keyboard, and localStorage persistence.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_grid_tooltip_resize'

## Instructions

- Run every command from the repository (or worktree) root.
- The Playwright config boots its own offline stack — do NOT start the app yourself.
- Return ONLY the JSON array with test results (valid JSON, no markdown wrapping).
- If a test passes, omit the `error` field.
- If a test fails, include the failure message and the step where it failed in `error`.

## Setup

1. If `.ports.env` exists at the repo/worktree root, source it: `source .ports.env`.
2. Run the targeted spec:
   ```
   npx playwright test e2e/grid_tooltip_resize.spec.ts
   ```
   If the spec file does not yet exist, run the full suite instead:
   ```
   npm run test:e2e
   ```

## Test Steps

Sign in as `e2e-analyst@example.test` (role: Analyst, tenant: E2E Co) via the dev sign-in
form, then navigate to an existing analyzed assessment (use the seeded demo assessment).

### Tooltip tests — desktop viewport 1280×800

1. Hover a Vendor response cell that contains truncated text → assert a tooltip overlay
   becomes visible (role="tooltip") containing the full response text.
2. Tab-focus the same cell's trigger element → assert the tooltip appears; press `Escape` →
   assert the tooltip disappears.
3. Assert the full response text is present in the DOM (not hidden by `display:none` or
   `visibility:hidden`) so screen readers can access it — `line-clamp-2` clips visually
   but does not remove content from the DOM.

### Tooltip tests — mobile viewport 375×812

4. Tap a truncated Vendor response cell → assert a tooltip/popover element appears with the
   full response text.
5. Tap a point outside the tooltip trigger → assert the tooltip is dismissed (no longer
   visible).

### Resize tests — desktop viewport 1280×800

6. Locate the Vendor response column resize handle (aria-label "Resize Vendor response
   column"). Drag it approximately 50 px to the right using a pointer drag sequence
   (pointerdown → pointermove → pointerup) → assert the `<col>` element for the Vendor
   response column has a width greater than the default 220 px.
7. Reload the page → assert the Vendor response column width is restored from localStorage
   (`vrp-grid-col-widths-v1`) and still wider than 220 px.
8. Double-click the Vendor response resize handle → assert the column width returns to the
   default 220 px.

### Screenshot

Take a screenshot of the grid (scoped to the table card) showing the tooltip overlay and
resize handle at 1280×800 viewport for visual confirmation.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "Tooltip appears on hover of truncated Vendor response cell",
    "status": "passed",
    "execution_command": "npx playwright test e2e/grid_tooltip_resize.spec.ts"
  }
]
```
