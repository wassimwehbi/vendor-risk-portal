# Spec — Patch: Disable grid column resize handles on coarse-pointer (mobile) devices

- **Status:** Draft
- **Branch:** patch-issue-38-adw-f46d0594-disable-mobile-column-resize
- **Location:** `client/src/pages/ReviewWorkspace.tsx`
- **Related docs:** `specs/adw/issue-29-adw-1952b0f3-grid-tooltip-resizable-columns-plan.md`

## Problem / Objective

**Original Spec:** `specs/adw/issue-29-adw-1952b0f3-grid-tooltip-resizable-columns-plan.md`

**Issue:** The assessment grid renders resize handle `<button>` elements on every `<th>` regardless of device type. On touch/coarse-pointer devices the handles are easy to trigger accidentally during scrolling and add visual clutter. The current workaround (`[@media(pointer:coarse)]:opacity-40`) merely dims the handles rather than removing them — a tappable strip still exists on mobile.

**Solution:** Detect `(pointer: coarse)` at runtime via `matchMedia`. When true: (1) do not render any resize handle `<button>` elements, and (2) use `DEFAULT_COL_WIDTHS` directly instead of the stored/customised widths so the grid is always at its clean default layout on mobile. Desktop behavior is completely unchanged.

## Approach & Changes

### Files to Modify

- `client/src/pages/ReviewWorkspace.tsx` only

### Implementation Steps

### Step 1: Add `isCoarsePointer` state to `ReviewWorkspace`

Inside `ReviewWorkspace` (after the existing `useResizableColumns` call), add a piece of state that reads the pointer media query once at mount:

```ts
const [isCoarsePointer] = useState(
  () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
);
```

A static snapshot is sufficient — pointer capability does not change during a session.

### Step 2: Use `DEFAULT_COL_WIDTHS` on coarse-pointer devices

The line that spreads `widths` into the `<col>` elements should switch to `DEFAULT_COL_WIDTHS` when on mobile:

```ts
const activeWidths = isCoarsePointer ? DEFAULT_COL_WIDTHS : widths;
```

Replace all eight `widths.<key>` references in the `<colgroup>` with `activeWidths.<key>`.

### Step 3: Conditionally render each resize handle button

For all eight resize handle `<button>` elements in `<thead>` (Control area, Vendor response, Framework mapping, AI finding, Evidence, Risk, Analyst columns): wrap each with `{!isCoarsePointer && <button ... />}`.

Remove the now-redundant `[@media(pointer:coarse)]:opacity-40` Tailwind modifier from every button's `className` since the element will no longer render on coarse-pointer devices.

## Key Decisions & Rationale

**Lines of code to change:** ~25 (1 new state line, 1 `activeWidths` alias, 7× conditional render + class cleanup, 8× colgroup reference updates)

**Risk level:** low — purely additive gate; desktop code path is untouched

**Testing required:** UX regression screenshots at mobile (375 px / coarse pointer emulation) and desktop (1280 px). Existing unit + typecheck + build suite.

## Verification

Execute every command to validate the patch is complete with zero regressions.

- `npm run check` — Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` — Server + client TypeScript type checks
- `npm run test` — Server + client unit tests
- `npm run build` — Client production build

**UX acceptance criteria (before/after screenshots required via `/ux_validate`):**

- **Mobile (375 px viewport, coarse pointer emulated):**
  - Before: seven semi-transparent resize handle strips visible in grid header.
  - After: no resize handle elements present in the DOM; grid header columns render at default widths with no tappable handle strip.
- **Desktop (1280 px viewport, fine pointer):**
  - Before & after: identical — resize handles appear on hover, drag/double-click/keyboard resize all work.

## Known Limitations / Follow-ups

- `isCoarsePointer` is sampled once at mount. On hybrid devices that switch between mouse and touch mid-session the state will not update — this is acceptable for v1 (matching the same trade-off made in `Layout.tsx`).
- Column widths saved in `localStorage` from a prior desktop session are preserved; they are simply ignored on mobile and will resume on the next desktop visit.
