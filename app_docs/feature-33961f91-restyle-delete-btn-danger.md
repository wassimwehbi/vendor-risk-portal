# Restyle Details-Page Delete Button as `.btn-danger`

**ADW ID:** 33961f91
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/patch-adw-33961f91-restyle-delete-btn-danger-plan.md

## Overview

The Delete button on the assessment details page was restyled from an unstyled red text link to a proper `.btn-danger` pill button that is visually consistent with the sibling action buttons (`btn-ghost`, `btn-secondary`, `btn-primary`) in the page-header action row. A shared `.btn-danger` CSS utility was added to the design system, and the button now includes a leading trash icon and is visually separated from the constructive actions via a flex spacer.

## What Was Built

- New `.btn-danger` shared utility class in the CSS design system
- Mobile min-height rule extended to include `.btn-danger` (≥40px touch target)
- Restyled Delete button in `ReviewWorkspace.tsx` with consistent pill shape, height, radius, and padding matching sibling buttons
- Inline SVG trash icon (Heroicons 16px solid, `aria-hidden`) prefixing the button label
- Flex spacer (`<span className="flex-1" />`) separating Delete from the constructive action group (`Audit trail`, `View report`, `Run AI analysis`)

## Technical Implementation

### Files Modified

- `client/src/index.css`: Added `.btn-danger` component utility after `.btn-ghost` in `@layer components`; added `.btn-danger` to the mobile `min-height: 2.5rem` rule
- `client/src/pages/ReviewWorkspace.tsx`: Replaced bare text-link button classes with `btn-danger`, added inline SVG trash icon and `<span className="flex-1" />` spacer

### Key Changes

- `.btn-danger` is defined as `@apply btn border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:border-red-300 focus:ring-red-600/30` — an outline-danger variant that shares the base `btn` token for consistent sizing
- The trash icon uses the Heroicons 16px solid path as an inline SVG (no external dependency); `aria-hidden="true"` keeps it decorative
- A `<span className="flex-1" aria-hidden="true" />` between the Delete button fragment and the constructive actions pushes the constructive group to the right within the `flex items-center gap-2` `PageHeader` actions container
- `text-red-700` on a white background provides ~5.9:1 contrast ratio (WCAG AA compliant)
- The Dashboard grid row Delete link is intentionally unchanged

## How to Use

The Delete button on the assessment details page is available to admin users only:

1. Open an assessment details page (`/assessments/:id`)
2. Log in as an admin user
3. The **Delete** button (trash icon + label) appears at the left end of the header action bar, separated from the other actions
4. Click **Delete** — a confirmation dialog prompts before deletion proceeds
5. On confirmation, the assessment is deleted and the user is redirected to the Dashboard

## Configuration

No configuration required. The button is conditionally rendered for `isAdmin` users only, which is determined by the existing auth context.

## Testing

- `npm run check` — Biome lint + format (run from repo root)
- `npm run typecheck` — TypeScript check for server + client
- `npm run build` — Client production build
- `npm run test:ux` — Scenario-driven UX regression suite; confirms no new axe violations and no page overflow at 375px
- `npx playwright test e2e/admin_delete_assessment.spec.ts` — E2E flow covering the delete button on the details page

## Notes

- The `flex-1` spacer approach depends on `PageHeader` wrapping actions in `flex items-center gap-2`. If that layout changes, the separator strategy may need revisiting.
- The Dashboard grid row Delete link intentionally retains its existing text-link style to avoid scope creep; visual consistency between the two surfaces is a potential follow-up.
