# Assessment Grid: Tooltip for Cropped Cells + Resizable Columns

**ADW ID:** 1952b0f3
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/issue-29-adw-1952b0f3-grid-tooltip-resizable-columns-plan.md

## Overview

Adds two lightweight, reusable UX improvements to the control-by-control grid on the `/assessments/:id` Review Workspace: a `Tooltip` component that surfaces full text on hover/focus/tap for truncated cells, and drag-to-resize column handles backed by `localStorage` persistence. Both features are built on the existing `<table>` layout with no external data-grid library.

## What Was Built

- **`Tooltip` component** in `client/src/components/ui.tsx` — portal-based overlay triggered by mouse hover, keyboard focus, or touch tap; dismisses on `Escape` or outside tap; includes ARIA `role="tooltip"` and `aria-describedby` for screen readers.
- **Tooltip wrapping** in `FindingRow.tsx` — Vendor response (`line-clamp-2`), AI finding, and Framework mapping cells wrapped with `Tooltip` to show full text when content overflows.
- **`useResizableColumns` hook** in `ReviewWorkspace.tsx` — manages per-column widths with `[80, 400]` px clamping, drag via Pointer Events, double-click reset, and `localStorage` persistence under key `vrp-grid-col-widths-v1`.
- **`<colgroup>` + `table-layout: fixed`** added to the assessment grid table for programmatic column widths.
- **Resize handle buttons** inside each `<th>` (except Actions) — keyboard-operable via ArrowLeft/Right, visible on hover/focus, always slightly visible on touch devices.
- **E2E test spec** at `.claude/commands/e2e/test_grid_tooltip_resize.md` covering tooltip and resize interactions on desktop and mobile viewports.

## Technical Implementation

### Files Modified

- `client/src/components/ui.tsx`: Added `Tooltip` component using `createPortal`, `useId`, `useRef`, `useEffect`, `useState`; renders an absolutely-positioned slate-800 dark panel into `document.body`.
- `client/src/components/FindingRow.tsx`: Wrapped Vendor response, AI finding, and Framework mapping cells with `<Tooltip>`; added `useTruncated` ref-based check so tooltips only appear when text is genuinely truncated.
- `client/src/pages/ReviewWorkspace.tsx`: Added `useResizableColumns` hook, `DEFAULT_COL_WIDTHS` constant, `<colgroup>`, `table-layout: fixed` style, and resize handle `<button>` elements inside each resizable `<th>`.
- `biome.json`: Minor lint/format config adjustment.
- `.claude/commands/e2e/test_grid_tooltip_resize.md`: New E2E test specification for this feature.

### Key Changes

- `createPortal` renders the tooltip into `document.body` to escape `overflow: hidden` on ancestor table cells — without this, the overlay would clip.
- Pointer Events (`onPointerDown` + `setPointerCapture`) provide a single drag-handling code path for both mouse and touch; `window` listeners for `pointermove`/`pointerup`/`pointercancel` are attached and removed per drag to avoid leaks.
- `table-layout: fixed` with `<colgroup>` is required for browsers to respect programmatic `<col>` widths; auto-layout mode ignores them.
- Column widths are initialized from `localStorage` (`vrp-grid-col-widths-v1`), spread over `DEFAULT_COL_WIDTHS` so newly-added columns always have a fallback.
- Tooltip position is computed via `getBoundingClientRect()` at show time and rendered with `position: fixed` — no repositioning on scroll (acceptable since users are unlikely to scroll while a tooltip is open).

## How to Use

### Tooltips

1. Navigate to `/assessments/:id` and open an analyzed assessment.
2. Hover over (or tab-focus) any truncated cell in the Vendor response, AI finding, or Framework mapping columns.
3. A dark (`bg-slate-800`) tooltip panel appears below the cell with the full text.
4. Move the mouse away, blur, press `Escape`, or tap elsewhere to dismiss.
5. On touch devices, tap a truncated cell to show the tooltip; tap anywhere else to dismiss.

### Resizable Columns

1. On the assessment grid, hover over the right edge of any column header to reveal the resize handle (a narrow `bg-brand-200` bar).
2. Click and drag the handle left or right to adjust the column width (clamped to 80–400 px).
3. Release the pointer to confirm the new width — it is saved automatically to `localStorage`.
4. Reload the page: column widths are restored from `localStorage`.
5. Double-click a resize handle to reset that column to its default width.
6. Keyboard: tab to a resize handle, then press `ArrowLeft` / `ArrowRight` to adjust by 10 px increments.

## Configuration

| Key | Default | Description |
|---|---|---|
| `vrp-grid-col-widths-v1` (localStorage) | See defaults below | Per-browser column width map. Delete this key to reset all columns. |

Default column widths:

| Column | Default (px) |
|---|---|
| Control area | 160 |
| Vendor response | 220 |
| Framework | 160 |
| AI finding | 200 |
| Evidence | 100 |
| Risk | 80 |
| Analyst | 90 |
| Actions | 80 |

## Testing

```sh
# From repo root
npm run check          # Biome lint + format
npm run typecheck      # Server + client TypeScript
npm run test           # Server + client unit tests
npm run build          # Client production Vite build
```

For end-to-end validation, run the dedicated E2E spec:

```sh
# Via the Claude Code skill
/e2e:test_grid_tooltip_resize
```

The E2E spec covers:
- Tooltip on hover, keyboard focus, and `Escape` dismiss (desktop 1280×800)
- Touch tap shows / outside tap dismisses (mobile 375×812)
- Screen-reader: full text remains in DOM
- Drag resize increases `<col>` width; width persists after reload; double-click resets

## Notes

- Tooltip positioning is computed at show time using `getBoundingClientRect`; it does not reposition on scroll. This is acceptable because users do not typically scroll while a tooltip is visible.
- Column widths are stored per-browser, not per-user account. Each analyst has an independent layout — this is intentional for v1.
- Resize handles are invisible by default (opacity 0) on pointer-fine devices and slightly visible (opacity 40%) on coarse-pointer (touch) devices so they remain discoverable without cluttering the desktop UI.
- If new columns are added to the grid in future, extend `DEFAULT_COL_WIDTHS` in `ReviewWorkspace.tsx`; the hook merges localStorage values on top of defaults so existing stored layouts will not break.
- As always, AI-generated findings in this portal are preliminary input for analyst review. **The final vendor-risk decision is always made by a human analyst.**
