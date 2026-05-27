# Spec — Patch: Restyle details-page Delete button as `.btn-danger`

- **Status:** Draft
- **Branch:** patch-issue-34-adw-33961f91-restyle-delete-btn-danger
- **Location:** `client/src/index.css`, `client/src/pages/ReviewWorkspace.tsx`
- **Related docs:** `specs/adw/issue-27-adw-acacd206-admin-delete-assessment-plan.md`, `specs/0012-ux-tasks-harness.md`

## Problem / Objective
**Original Spec:** `specs/adw/issue-27-adw-acacd206-admin-delete-assessment-plan.md`
**Issue:** The Delete button on the assessment details page (`ReviewWorkspace.tsx`) uses a compact text-link style (`text-xs font-medium text-red-600 hover:underline`) that is visually inconsistent with the sibling pill buttons (`btn-ghost`, `btn-secondary`, `btn-primary`) in the page-header action row — wrong height, no border, misaligned baseline.
**Solution:** Add a `.btn-danger` shared utility to `index.css` and apply it in `ReviewWorkspace.tsx` with a trash icon and left-separated placement, while leaving the Dashboard grid row delete link untouched.

## Approach & Changes
### Files to Modify
- `client/src/index.css` — add `.btn-danger` component utility + mobile min-height rule
- `client/src/pages/ReviewWorkspace.tsx` — replace text-link classes with `btn-danger`, add inline SVG trash icon, separate Delete from constructive actions

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `.btn-danger` to `client/src/index.css`
- In the `@layer components` block, after `.btn-ghost`, add:
  ```css
  .btn-danger {
    @apply btn border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:border-red-300
           focus:ring-red-600/30;
  }
  ```
- In the `@media (max-width: 639px)` mobile min-height rule, add `.btn-danger` alongside `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`:
  ```css
  .btn,
  .btn-primary,
  .btn-secondary,
  .btn-ghost,
  .btn-danger {
    min-height: 2.5rem;
  }
  ```

### Step 2: Update Delete button in `ReviewWorkspace.tsx`
- Replace the current button (lines ~204–210):
  ```tsx
  <button
    className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
    onClick={handleDelete}
    disabled={deleting}
  >
    {deleting ? 'Deleting…' : 'Delete'}
  </button>
  ```
  with a `btn-danger` button that includes a trash SVG icon and is separated from the constructive actions via a flex spacer:
  ```tsx
  {isAdmin && (
    <>
      <button
        className="btn-danger"
        onClick={handleDelete}
        disabled={deleting}
      >
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
          <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z" clipRule="evenodd" />
        </svg>
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
      <span className="flex-1" aria-hidden="true" />
    </>
  )}
  ```
  The `<span className="flex-1" />` pushes the constructive actions (`Audit trail`, `View report`, `Run AI analysis`) to the right, creating a clear visual separation without a hard rule.

  Note: The `PageHeader` actions container uses `flex items-center gap-2` (`ui.tsx:40`), so `flex-1` on the spacer span will consume remaining space between Delete and the constructive group.

## Key Decisions & Rationale
**Lines of code to change:** ~15 (5 in `index.css`, ~10 in `ReviewWorkspace.tsx`)
**Risk level:** low
**Testing required:** UX regression (`npm run test:ux`), build check, typecheck

## Verification
Execute every command to validate the patch is complete with zero regressions.

- `npm run check` — Biome lint + format (run from repo root)
- `npm run typecheck` — TypeScript check for server + client
- `npm run build` — Client production build
- `npm run test:ux` — Scenario-driven UX regression suite (spec 0012); confirm no new serious/critical axe violations and no page overflow

**UX acceptance criteria (before/after):**
- Before: Delete is a tiny underlined red text link, visually misaligned with pill siblings.
- After: Delete is an outline-danger pill (`btn-danger`) with a leading trash icon, separated from `Audit trail / View report / Run AI analysis` by a flex spacer; same height/radius/padding as sibling buttons; `text-red-700` on white (~5.9:1 WCAG AA); visible red focus ring; `aria-hidden` on icon; ≥40px touch target on mobile; no horizontal overflow at 375px.
- Dashboard grid row Delete link is unchanged.

## Known Limitations / Follow-ups
- The `flex-1` spacer approach works because `PageHeader` wraps actions in `flex items-center gap-2`. If the header layout changes, the separator approach may need revisiting.
- The trash icon uses Heroicons 16px solid path (inline SVG, no external dependency).
