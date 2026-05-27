# Spec — Assessment Grid: Tooltip for Cropped Cells + Resizable Columns

- **Status:** Draft
- **Branch:** 1952b0f3-issue-29-adw-1952b0f3-grid-tooltip-resizable-columns
- **Location:** `client/src/components/ui.tsx`, `client/src/components/FindingRow.tsx`, `client/src/pages/ReviewWorkspace.tsx`, `.claude/commands/e2e/test_grid_tooltip_resize.md`
- **Related docs:** `specs/0005-responsive-mobile-layout.md`, `specs/0001-vendor-risk-questionnaire-portal.md`, `README.md`

## Problem / Objective

**User Story:** As an analyst reviewing a vendor assessment, I want to see the full vendor response text when I hover (or tap) a truncated cell in the control grid, and I want to resize column widths to fit my workflow — so that I can read lengthy responses without expanding every row, and I can adjust the layout to prioritize the columns I care about.

**Problem Statement:** The control-by-control grid on `/assessments/:id` truncates the Vendor response to two lines (`line-clamp-2`) and the AI finding to a fixed max-width, with no way to read the full text without expanding the detail row. Column widths are fixed and non-adjustable, making it impossible to widen a column for a long vendor answer or narrow one that is always short. Neither a tooltip primitive nor column-resize logic exists anywhere in the codebase today.

## Approach & Changes

We add two lightweight, reusable primitives to the existing `<table>`-based grid — no heavy data-grid library:

1. **`Tooltip` component** (`client/src/components/ui.tsx`) — a small accessible overlay that shows the full text for any truncated cell. Triggers on hover, keyboard focus, and touch tap. Uses `aria-describedby` and keeps the underlying text in the DOM for screen readers.

2. **Column-resize logic** (`client/src/pages/ReviewWorkspace.tsx`) — drag handles on `<col>` elements (via Pointer Events so mouse and touch share one code path). The table switches to `table-layout: fixed` with a `<colgroup>` that holds explicit widths. Widths persist in `localStorage` and can be reset by double-clicking a handle.

### Relevant files

- `client/src/components/ui.tsx` — shared primitive library; `Tooltip` is added here so it can be reused anywhere.
- `client/src/components/FindingRow.tsx` — wraps the Vendor response cell (line 151), AI finding cell (line 169), and Framework mapping cell with `Tooltip` where text may be truncated.
- `client/src/pages/ReviewWorkspace.tsx` — adds `<colgroup>` + resize handles to the `<table>`, manages column-width state in a `useResizableColumns` hook (defined in the same file or a sibling module), persists to `localStorage`.
- `.claude/commands/e2e/test_grid_tooltip_resize.md` — E2E test spec for this feature.

### New Files

- `.claude/commands/e2e/test_grid_tooltip_resize.md` — E2E test specification.

### Implementation Plan

**Phase 1 — Foundation: Tooltip primitive**
Build a self-contained `Tooltip` component in `ui.tsx`. It wraps any child element, listens for `mouseenter`/`mouseleave`, `focus`/`blur`, `touchstart`, and `keydown Escape`, and renders a positioned overlay with the full text. Use a React portal (`createPortal` into `document.body`) to avoid overflow clipping from ancestor table cells. The tooltip panel uses slate surface styling (`bg-slate-800 text-white` dark variant, or `bg-white ring-1 ring-slate-200 shadow-md` light variant — match existing card shadow token). Accessibility: the trigger element gains `aria-describedby` pointing to the tooltip panel.

**Phase 2 — Core Implementation: Truncated-cell wrapping**
Update `FindingRow.tsx` to wrap the three truncated cells with the new `Tooltip`. Only show the tooltip when text is actually truncated — detect truncation with a `ref` comparing `scrollWidth > clientWidth` (or `scrollHeight > clientHeight` for multi-line clamp). For the Vendor response `line-clamp-2` paragraph, use a `useRef` + `useEffect` to check after render. Pass the full text as the tooltip content.

**Phase 3 — Core Implementation: Resizable columns**
Switch the table to `table-layout: fixed` and add a `<colgroup>` in `ReviewWorkspace.tsx`. Implement a `useResizableColumns` hook that:
- Stores column widths in a `Record<string, number>` state (keyed by column name).
- Provides default widths with sensible min/max bounds.
- Persists to `localStorage` under a stable key (`vrp-grid-col-widths-v1`).
- Exposes a `resetWidths()` function.
- Returns resize-handle props (pointer event handlers) for each column divider.

Add visible resize handle elements inside each `<th>` — absolutely positioned on the right edge, 8–12px wide touch target (wider on coarse pointer), with `cursor: col-resize`. Use `onPointerDown` to start a drag, `onPointerMove` on `document` to update the active column width (delta from start X), and `onPointerUp` / `onPointerCancel` to end. Double-click a handle resets that column to its default width.

The outer `overflow-x-auto` wrapper is preserved so the table can still scroll horizontally on narrow viewports.

### Step by Step Tasks

#### Task 1 — Read E2E test infrastructure and create the E2E test spec

- Read `.claude/commands/test_e2e.md` to understand the test format.
- Read `.claude/commands/e2e/test_date_input_alignment.md` for a concrete example of a well-formed E2E test spec.
- Create `.claude/commands/e2e/test_grid_tooltip_resize.md` with the following content:
  - Sign in as `e2e-analyst@example.test` (Analyst, E2E Co tenant) via dev sign-in.
  - Navigate to an existing analyzed assessment (use the seeded demo assessment).
  - **Tooltip tests (desktop viewport 1280×800):**
    1. Hover a Vendor response cell that contains truncated text → assert a tooltip overlay becomes visible containing the full text.
    2. Tab-focus the same cell's trigger → assert tooltip appears; press `Esc` → assert tooltip disappears.
    3. Assert the full response text is still in the DOM (not hidden) for screen reader access.
  - **Tooltip test (mobile viewport 375×812):**
    4. Tap a truncated Vendor response cell → assert tooltip/popover appears with full text.
    5. Tap elsewhere → assert tooltip is dismissed.
  - **Resize tests (desktop viewport 1280×800):**
    6. Drag the Vendor response column resize handle ~50px to the right → assert the column `<col>` element's width increases.
    7. Reload the page → assert column widths are restored from localStorage (width persists).
    8. Double-click the resize handle → assert column resets to default width.
  - Take a screenshot of the grid showing tooltips and resize handles.
  - Return JSON array per `test_e2e.md` format.

#### Task 2 — Add `Tooltip` primitive to `client/src/components/ui.tsx`

- Import `useEffect`, `useId`, `useRef`, `useState` from React and `createPortal` from `react-dom`.
- Implement `Tooltip` component:
  ```tsx
  export function Tooltip({ content, children }: { content: string; children: ReactNode }) { ... }
  ```
  - Renders `children` inside a `<span>` wrapper with `tabIndex={0}` (makes it keyboard-focusable).
  - Tracks `visible` state; sets it true on `mouseenter`, `focus`, `touchstart`; false on `mouseleave`, `blur`, `touchstart` on document (outside), `keydown Escape`.
  - Uses a `ref` on the wrapper span to compute tooltip position (use `getBoundingClientRect()` + `window.scroll*` to position absolutely in body).
  - Renders the tooltip panel via `createPortal` into `document.body` only when `visible`.
  - Panel classes: `pointer-events-none fixed z-50 max-w-xs rounded-md bg-slate-800 px-3 py-2 text-xs text-white shadow-lg`.
  - Connects panel with `id={tooltipId}` and wrapper with `aria-describedby={tooltipId}`.
  - `role="tooltip"` on the panel element.

#### Task 3 — Wrap truncated cells in `FindingRow.tsx` with `Tooltip`

- Import `Tooltip` from `./ui`.
- Add a `useTruncated(ref)` utility (inline, ~10 lines) that returns `true` when the referenced element's `scrollWidth > clientWidth || scrollHeight > clientHeight`. Call it after render via `useLayoutEffect`.
- **Vendor response cell** (line 151): wrap the `<p className="line-clamp-2 …">` with `<Tooltip content={item.response}>…</Tooltip>`. Only render `Tooltip` when `item.response` is non-empty and text is truncated (check truncation on a ref attached to the `<p>`).
- **AI finding cell** (line 169): similarly wrap `<p className="max-w-[16rem]">` with `Tooltip` when `finding.ai_finding` is truncated.
- **Framework mapping cell** (lines 155–166): since this is a list, wrap the outer `<ul>` container if the container overflows.
- Keep `line-clamp-2` and `max-w-*` classes as-is — the crop remains; tooltip supplements it.

#### Task 4 — Add resizable columns to `ReviewWorkspace.tsx`

- Define default column widths as a constant:
  ```ts
  const DEFAULT_COL_WIDTHS: Record<string, number> = {
    control:   160,
    response:  220,
    framework: 160,
    finding:   200,
    evidence:  100,
    risk:       80,
    analyst:    90,
    actions:    80,
  };
  ```
- Implement `useResizableColumns` hook within the file:
  - State: `widths` (Record), initialized from `localStorage` (`vrp-grid-col-widths-v1`) falling back to `DEFAULT_COL_WIDTHS`.
  - Effect: persist `widths` to localStorage on every change.
  - `resetColumn(key)` and `resetAll()`: restore to defaults.
  - `startResize(key, e: React.PointerEvent)`: capture pointer, record `startX` + `startWidth`; attach `pointermove` and `pointerup` listeners on `window` that update `widths[key]` clamped to `[80, 400]`; remove listeners on `pointerup`/`pointercancel`.
  - Returns `{ widths, startResize, resetColumn }`.
- In the `<table>`, add `style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}`.
- Add `<colgroup>` before `<thead>` with one `<col>` per column, each with `style={{ width: widths[key] }}`.
- Add resize handles inside each `<th>` (except the last "Actions" column which gets no handle):
  ```tsx
  <span
    role="separator"
    aria-label={`Resize ${label} column`}
    aria-orientation="vertical"
    className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none opacity-0 hover:opacity-100 focus-visible:opacity-100 bg-brand-300"
    onPointerDown={(e) => startResize(key, e)}
    onDoubleClick={() => resetColumn(key)}
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'ArrowLeft') updateWidth(key, -10);
      if (e.key === 'ArrowRight') updateWidth(key, +10);
    }}
  />
  ```
  Each `<th>` needs `className="... relative"` to contain the absolute handle.
- Add `updateWidth(key, delta)` helper that clamps and updates the width.

#### Task 5 — Run validation commands

- Run `npm run check` (Biome lint + format) from repo root and fix any issues.
- Run `npm run typecheck` (server + client TypeScript) from repo root and fix any issues.
- Run `npm run test` (server + client unit tests) and confirm they all pass.
- Run `npm run build` (client production build via Vite) and confirm it succeeds.
- Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_grid_tooltip_resize.md` to validate this functionality works end-to-end.

## Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| `createPortal` for tooltip overlay | Table cells have `overflow: hidden` / `overflow: clip` applied by browser layout; a portal into `document.body` escapes that so the tooltip never clips. |
| Pointer Events for resize (not mouse + touch separately) | Single code path handles both desktop mouse drag and mobile touch drag. `setPointerCapture` ensures the drag tracks even if the pointer leaves the handle. |
| `table-layout: fixed` + `<colgroup>` | Required for programmatic column widths; without it browsers ignore `<col width>` in auto-layout mode. |
| `localStorage` key `vrp-grid-col-widths-v1` | Scoped key avoids collisions; `-v1` suffix allows breaking-change resets in future. |
| Tooltip only when truncated | Redundant tooltips for short text are noisy. A `scrollWidth > clientWidth` check at mount/update ensures tooltips only appear when genuinely needed. |
| No external grid library | Keeps the bundle small and avoids forcing a major architectural change just for two UX improvements. The existing `<table>` is preserved. |
| Keyboard-operable resize handles | `tabIndex={0}` + ArrowLeft/Right key handling so keyboard users are not locked out of column resizing. |
| Dark-surface tooltip panel (`bg-slate-800 text-white`) | Provides high contrast against the white card background without needing a separate light/dark mode implementation. |

## Verification

### Unit Tests & Edge Cases

- `Tooltip` renders nothing when `content` is empty string.
- `Tooltip` tooltip panel is absent from DOM when `visible = false`.
- `Tooltip` panel appears in DOM after `mouseenter` event on trigger.
- `Tooltip` dismisses on `Escape` keydown.
- `useResizableColumns` initializes from localStorage when key is present.
- `useResizableColumns` clamps widths to `[80, 400]`.
- `useResizableColumns` `resetColumn` restores to `DEFAULT_COL_WIDTHS[key]`.
- (No new server tests needed — purely client-side UI change.)

### Acceptance Criteria

- [ ] Hovering a cropped Vendor response cell shows the full response text in a styled tooltip (slate-800 dark panel).
- [ ] Keyboard focus on the trigger shows the tooltip; `Esc` dismisses it.
- [ ] On a 375 px touch viewport, tapping a truncated cell reveals the full text; tapping elsewhere dismisses it.
- [ ] Tooltip only appears when the text is actually truncated (verified by `scrollWidth` check).
- [ ] The full text remains in the DOM (not hidden) — `line-clamp-2` stays in place; only visual display is clipped.
- [ ] AI finding and Framework mapping cells also receive tooltips when their content overflows.
- [ ] Columns can be resized by dragging their right-edge handles with mouse or touch; widths are clamped to `[80, 400]` px.
- [ ] Column widths persist across page navigation and reload (localStorage).
- [ ] Double-clicking a resize handle resets that column to its default width.
- [ ] The `overflow-x-auto` wrapper still enables horizontal scroll on narrow viewports; no layout breakage.
- [ ] `npm run check`, `npm run typecheck`, `npm run test`, and `npm run build` all pass with zero errors.
- [ ] E2E test `test_grid_tooltip_resize.md` passes.

### Validation Commands

```sh
# From repo root
npm run check          # Biome lint + format
npm run typecheck      # Server + client TypeScript
npm run test           # Server + client unit tests
npm run build          # Client production Vite build
```

Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_grid_tooltip_resize.md` to validate this functionality works end-to-end.

## Known Limitations / Follow-ups

- The truncation detection (`scrollWidth > clientWidth`) fires after first render; there is a brief window where the tooltip trigger is present but the tooltip would not show (if the element is not yet measured). In practice this is imperceptible.
- Column widths are stored per-browser, not per-user-account. Multi-analyst teams will each have independent persisted layouts — this is acceptable for v1.
- The resize handle opacity is 0 by default and shows on hover / focus; on mobile there is no hover state, so handles are always slightly visible (opacity 0.4) on coarse-pointer devices to remain discoverable.
- If the table gains additional columns in future, `DEFAULT_COL_WIDTHS` must be extended; no automatic fallback width is provided beyond the existing defaults.
- The `Tooltip` positions itself using `getBoundingClientRect` at show time; it does not reposition on scroll. For a table inside a scroll container this is acceptable since the user is typically not scrolling while a tooltip is visible.
