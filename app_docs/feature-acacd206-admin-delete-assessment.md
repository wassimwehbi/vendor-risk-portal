# Admin Delete Assessment

**ADW ID:** acacd206
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/issue-27-adw-acacd206-admin-delete-assessment-plan.md

## Overview

This feature adds a hard-delete capability for assessments, accessible only to global Admin users. Admins can delete any assessment from the Dashboard table or from the assessment's ReviewWorkspace page, permanently removing the assessment and all its dependent data (findings, questionnaire items, evidence files, and audit log entries).

## Screenshots

![Dashboard with Delete actions visible](assets/admin_delete_dashboard.png)

![Dashboard after assessment deletion](assets/admin_delete_after.png)

## What Was Built

- `DELETE /assessments/:id` REST endpoint protected by `requireAdmin` middleware
- `deleteAssessment` service function with cascading DB delete inside a transaction and best-effort evidence file unlink
- `api.deleteAssessment` client method
- Delete button in Dashboard assessment table rows (admin-only, with in-flight disabled state)
- Delete button in ReviewWorkspace page header (admin-only, navigates to `/` on success)
- `window.confirm` guard on both entry points before proceeding
- Server unit tests covering 403, 404, cascade delete, and audit logging
- Integration tests for the new endpoint
- Playwright E2E test spec (`e2e/admin_delete_assessment.spec.ts`)

## Technical Implementation

### Files Modified

- `server/src/services/store.ts`: Added `deleteAssessment(id, scope)` — scope-aware read guard, transactional cascade delete of findings/questionnaire_items/evidence_files/audit_log/assessment, post-commit audit entry, best-effort `unlinkSync` of uploaded files
- `server/src/routes/assessments.ts`: Added `DELETE /assessments/:id` route with `requireAdmin` middleware; returns 400 for bad id, 404 for unknown/out-of-scope, `{ deleted: true }` on success
- `client/src/api/client.ts`: Added `deleteAssessment` method using the existing `del` helper
- `client/src/pages/Dashboard.tsx`: Added `deletingId` state, `handleDelete` async handler, and Delete button per table row (admin-gated, flex row with existing Open link)
- `client/src/pages/ReviewWorkspace.tsx`: Added `deleting` state, `useNavigate`, `isAdmin` from `useAuth`, `handleDelete` async handler, and Delete button in the PageHeader actions slot
- `server/test/adminDelete.test.ts`: Unit tests for the store function and route (403, 404, cascade, audit)
- `server/test/api.integration.test.ts`: Integration tests for the new delete endpoint
- `e2e/admin_delete_assessment.spec.ts`: Playwright E2E spec
- `.claude/commands/e2e/test_admin_delete_assessment.md`: E2E test command specification

### Key Changes

- **Cascade delete in a single SQLite transaction** — findings, questionnaire_items, evidence_files, and audit_log rows are deleted before the assessment row, preventing foreign-key orphans
- **Audit entry written after commit** — uses `assessment_id: 0` (consistent with `tenant_deleted`/`user_deleted`) so the record survives but preserves the original id and vendor name in `details`
- **Best-effort file unlink** — `unlinkSync` runs outside the transaction; `ENOENT` and permission errors are silently swallowed, keeping DB state consistent even if filesystem operations fail
- **`requireAdmin` at the route level** — non-admin requests receive a 403 before any business logic; scope-aware `deleteAssessment` returns `false` for out-of-scope ids (→ 404), avoiding existence leaks
- **Optimistic UI removal on Dashboard** — the deleted row is filtered from React state immediately on success, without a refetch, for instant perceived response

## How to Use

**From the Dashboard:**
1. Sign in as an Admin account.
2. On the Dashboard, locate the assessment row to delete.
3. Click the **Delete** link (red text) in the Actions column.
4. Confirm the `window.confirm` dialog ("This cannot be undone.").
5. The row disappears from the table immediately.

**From the Assessment Page:**
1. Sign in as an Admin account.
2. Open an assessment (click **Open →** on the Dashboard).
3. Click the **Delete** button (red text) in the page header.
4. Confirm the dialog.
5. You are redirected to the Dashboard (`/`); the deleted assessment is no longer listed.

**Non-admin users** (Analyst, Viewer, Submitter) do not see the Delete button on either page.

## Configuration

No additional environment variables or configuration are required. The `requireAdmin` guard checks the `is_admin` column on the session user, which is set during user creation in the Admin panel.

The upload directory for best-effort file cleanup is resolved relative to the compiled server output (`server/src/services/store.ts` → `../../uploads`), matching the path used by the upload route.

## Testing

```bash
# Biome lint + format check
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# Server unit + integration tests (covers 403, 404, cascade delete, audit logging)
npm --prefix server test

# Client production build (includes tsc --noEmit)
cd client && npm run build

# Full Playwright E2E suite
npm run test:e2e
# Or target just the admin delete spec:
npx playwright test e2e/admin_delete_assessment.spec.ts
```

The E2E spec (`e2e/admin_delete_assessment.spec.ts`) covers:
- Admin sees Delete button; Analyst does not
- Dashboard delete: confirm dialog, row removal
- ReviewWorkspace delete: confirm dialog, redirect to `/`, assessment absent from list

## Notes

- **Hard delete only** — there is no soft-delete or restore. Once confirmed, the assessment and all its data are permanently removed.
- **Bulk delete is out of scope** — each deletion is a single, explicitly confirmed action.
- **All-tenants admin mode** — an admin with no pinned tenant can delete assessments across all tenants. Tenant-scoped admins can only delete within their tenant.
- **Orphaned uploads** — if `unlinkSync` fails silently, evidence files may remain in `server/uploads/`. A separate cleanup job would be needed to reclaim disk space in that edge case.
- The final vendor-risk decision is always made by a human analyst; this feature only removes erroneous or test submissions and does not affect the AI analysis workflow itself.
