# Disable Grid Column Resize Handles on Mobile (Coarse-Pointer) Devices

**ADW ID:** f46d0594
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/patch-adw-f46d0594-grid-mobile-disable-resize-plan.md

## Overview

The assessment grid previously rendered resize handle `<button>` elements on every column header regardless of device type. On touch/coarse-pointer devices (phones, tablets) these handles were easy to trigger accidentally during scrolling and added visual clutter. This patch detects `(pointer: coarse)` at runtime and completely removes the resize handles from the DOM on mobile, while preserving full resize functionality on desktop.

## What Was Built

- `isCoarsePointer` state flag sampled once at mount via `window.matchMedia('(pointer: coarse)')`
- `activeWidths` alias that falls back to `DEFAULT_COL_WIDTHS` on coarse-pointer devices, ignoring any localStorage-persisted custom widths
- Conditional rendering: all 7 resize handle `<button>` elements are omitted entirely from the DOM when `isCoarsePointer` is `true`
- Removal of the now-redundant `[@media(pointer:coarse)]:opacity-40` Tailwind modifier from all resize button `className` strings

## Technical Implementation

### Files Modified

- `client/src/pages/ReviewWorkspace.tsx`: Added `isCoarsePointer` state, `activeWidths` alias, switched `<colgroup>` from `widths.*` to `activeWidths.*`, and wrapped all 7 resize `<button>` elements in `{!isCoarsePointer && (...)}` guards

### Key Changes

- **Pointer detection:** `useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)` — lazy initializer runs once at mount; no event listener needed since pointer capability does not change mid-session
- **Width fallback:** `const activeWidths = isCoarsePointer ? DEFAULT_COL_WIDTHS : widths` — mobile always gets clean default column widths; localStorage-persisted widths from a prior desktop session are preserved and resume on the next desktop visit
- **DOM removal:** resize handles are not rendered (not just hidden) on coarse-pointer devices, eliminating the accidental-tap problem entirely
- **Desktop unchanged:** the fine-pointer code path is bit-for-bit identical to the prior implementation; hover, drag, double-click reset, and keyboard resize all continue to work

## How to Use

This change is automatic and requires no configuration.

- **On a phone or tablet** (coarse pointer): the assessment grid header displays column labels only — no resize strips are present. The grid uses default column widths.
- **On a desktop or laptop** (fine pointer): the grid behaves exactly as before — hover over a column edge to reveal the resize handle, drag to resize, double-click to reset to default, or use Arrow keys when the handle is focused.

## Configuration

No configuration required. The feature detects the pointer type automatically via the CSS `(pointer: coarse)` media query evaluated in JavaScript at component mount time.

## Testing

```bash
# From the repo root:
npm run check        # Biome lint + format
npm run typecheck    # TypeScript (server + client)
npm run test         # Unit tests (server + client)
npm run build        # Client production build
```

UX acceptance criteria verified via `/ux_validate`:
- **Mobile (375 px, coarse pointer emulated):** no resize handle elements in DOM; grid renders at default widths
- **Desktop (1280 px, fine pointer):** resize handles appear on hover; drag/double-click/keyboard resize all functional

## Notes

- `isCoarsePointer` is sampled once at mount. On hybrid devices that switch between mouse and touch mid-session the state will not update — this matches the same trade-off made elsewhere in the codebase (e.g., `Layout.tsx`).
- Column widths customised on desktop are stored in `localStorage` and are ignored on mobile; they resume automatically on the next desktop visit.
- The final vendor-risk decision is always made by a human analyst, never automatically by the AI.
