# Spec — feat: allow Admin to delete an assessment (Dashboard + assessment page)

- **Status:** Draft
- **Branch:** feat-issue-27-adw-acacd206-admin-delete-assessment
- **Location:** `server/src/routes/assessments.ts`, `server/src/services/store.ts`, `client/src/api/client.ts`, `client/src/pages/Dashboard.tsx`, `client/src/pages/ReviewWorkspace.tsx`, `.claude/commands/e2e/test_admin_delete_assessment.md`
- **Related docs:** `specs/0003-multi-tenancy-rbac.md`, `README.md`, `API_CONTRACT.md`

## Problem / Objective

**User Story:** As a global Admin, I want to delete a vendor risk assessment from the Dashboard or the assessment page, so that I can remove test, duplicate, or erroneous submissions that should not remain in the system.

**Problem Statement:** There is currently no way to remove an assessment once created. Admins already manage tenants and users with delete controls; assessments are the missing gap. Without a delete capability, orphaned test uploads and erroneous submissions accumulate permanently, cluttering the Dashboard and potentially misleading analysts.

Deletion is a hard, irreversible, admin-only operation. It must be explicitly confirmed before proceeding, and must cascade to all dependent data so no orphaned rows or uploaded files remain on disk.

## Approach & Changes

The solution adds a `DELETE /assessments/:id` endpoint, a `deleteAssessment` service function that deletes all dependent rows in a transaction and best-effort unlinks uploaded files, an API client method, and two UI entry points — one per-row in the Dashboard table and one in the ReviewWorkspace header.

**Authorization model:** Only the global `is_admin` flag (not a tenant membership role) permits deletion. The server guards the route with `requireAdmin`; the client renders the control only when `useAuth().isAdmin` is true. Non-admin users must never see or reach the delete action.

**Relevant files and why they matter:**

- `server/src/routes/assessments.ts` — the Express router where the new `DELETE /assessments/:id` route is added; currently has GET list, POST create, and GET detail routes only.
- `server/src/services/store.ts` — the data-access layer; `deleteAssessment(id, scope)` is added here, following the `replaceItems` cascade-delete pattern (transaction wrapping `DELETE FROM findings / questionnaire_items / evidence_files / audit_log` then the assessment itself).
- `server/src/middleware/tenant.ts` — exports `requireAdmin`; imported into assessments route.
- `server/src/services/audit.ts` — `logAudit` records the deletion event.
- `client/src/api/client.ts` — exports the `api` object; `deleteAssessment` is added using the existing `del` helper.
- `client/src/pages/Dashboard.tsx` — the assessments table at line 156 gets a `Delete` link alongside `Open →`, gated by `isAdmin`.
- `client/src/pages/ReviewWorkspace.tsx` — the `PageHeader` actions slot at line 114 gets a `Delete` button gated by `isAdmin`; on success the user is navigated back to `/`.
- `client/src/pages/Admin.tsx` — **read only** for reference: the red text-link delete pattern (`text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline`) must be copied exactly.

### New Files

- `.claude/commands/e2e/test_admin_delete_assessment.md` — Playwright E2E test specification for the admin delete feature.

### Implementation Plan

**Phase 1 — Foundation (backend)**
Add the `deleteAssessment(id, scope)` store function and the `DELETE /assessments/:id` route with `requireAdmin` protection and audit logging.

**Phase 2 — Core Implementation (API client + frontend)**
Wire up `api.deleteAssessment` in the client, then add the delete UI to the Dashboard table row and the ReviewWorkspace header.

**Phase 3 — E2E + Validation**
Create the E2E test file and run all validation commands (typecheck, unit tests, build, E2E).

### Step by Step Tasks

#### Step 1 — Create the E2E test specification file

- Read `.claude/commands/test_e2e.md` and `.claude/commands/e2e/test_date_input_alignment.md` to understand the E2E test file format.
- Create `.claude/commands/e2e/test_admin_delete_assessment.md` with these test steps:
  1. Sign in as an admin via dev-login (`e2e-admin@example.test`, role `Admin`).
  2. Navigate to the Dashboard `/`.
  3. Assert a `Delete` button is visible in the first assessment row's Actions cell.
  4. Sign out; sign in as an Analyst (`e2e-analyst@example.test`, role `Analyst`, tenant `E2E Co`).
  5. Assert NO `Delete` button appears on any Dashboard row.
  6. Sign in as admin again; click the `Delete` button on the first assessment row; assert `window.confirm` fires (dismiss it — do not proceed with deletion).
  7. Accept the confirm; assert the row disappears from the table.
  8. Navigate to an existing assessment page (`/assessments/:id`); assert a `Delete` button appears in the page header.
  9. Click `Delete` in the page header; accept confirm; assert navigation to `/` and assert the assessment is gone from the Dashboard.
  10. Take a screenshot of the Dashboard after deletion for visual confirmation.
- Target Playwright spec file: `e2e/admin_delete_assessment.spec.ts`.

#### Step 2 — Add `deleteAssessment` to `server/src/services/store.ts`

- Add the function signature and implementation after the existing `getAssessmentDetail` function (around line 135).
- Implementation:
  ```typescript
  export function deleteAssessment(id: number, scope: AccessScope): boolean {
    // Scope-aware read ensures the assessment is visible to this caller; returns
    // undefined for cross-tenant / non-existent ids (no existence leak).
    const assessment = getAssessment(id, scope);
    if (!assessment) return false;
    const tenantId = assessment.tenant_id;

    // Collect stored filenames before the transaction so we can unlink after commit.
    const storedFiles = (
      db.prepare('SELECT stored_name FROM evidence_files WHERE assessment_id = ?').all(id) as { stored_name: string }[]
    ).map((r) => r.stored_name);

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM findings WHERE assessment_id = ?').run(id);
      db.prepare('DELETE FROM questionnaire_items WHERE assessment_id = ?').run(id);
      db.prepare('DELETE FROM evidence_files WHERE assessment_id = ?').run(id);
      db.prepare('DELETE FROM audit_log WHERE assessment_id = ?').run(id);
      db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
    });
    tx();

    logAudit({
      assessment_id: 0,
      tenant_id: tenantId,
      action: 'assessment_deleted',
      actor: scope.actor,
      role: scope.effectiveRole,
      details: { assessment_id: id, vendor_name: assessment.vendor_name },
    });

    // Best-effort unlink of uploaded evidence files from disk.
    // `assessment_id: 0` is used in the audit entry so the record survives but is
    // no longer associated with a deleted assessment.
    return true;
  }
  ```
- For best-effort file unlinking, import `{ join }` from `'node:path'` and `{ unlinkSync }` from `'node:fs'` at the top of the file (only if not already imported); use the same `UPLOAD_DIR` path pattern as `server/src/routes/upload.ts` (`join(__dirname, '..', '..', 'uploads')`). Wrap each `unlinkSync` call in a try/catch (silently ignore ENOENT).
- Add `deleteAssessment` to the named export list so it can be imported into the route.

#### Step 3 — Add `DELETE /assessments/:id` route to `server/src/routes/assessments.ts`

- Import `requireAdmin` from `'../middleware/tenant'` (already imports `requireTenantRole` from there).
- Import `deleteAssessment` from `'../services/store'`.
- Add the route after the existing `GET /assessments/:id` handler:
  ```typescript
  router.delete('/assessments/:id', requireAdmin, (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return fail(res, 400, 'Invalid assessment id');
    const deleted = deleteAssessment(id, getScope(req));
    if (!deleted) return fail(res, 404, 'Assessment not found');
    ok(res, { deleted: true });
  });
  ```
- `requireAdmin` ensures a 403 for non-admins before the handler runs.
- The scope-aware `deleteAssessment` returns `false` for out-of-scope / unknown ids, which maps to a 404 (no existence leak).

#### Step 4 — Add `deleteAssessment` to `client/src/api/client.ts`

- Locate the `api` object (around line 95).
- Add the method immediately after `getAssessment`:
  ```typescript
  deleteAssessment: (id: number) => del<{ deleted: boolean }>(`/assessments/${id}`),
  ```

#### Step 5 — Add Delete action to Dashboard (`client/src/pages/Dashboard.tsx`)

- Destructure `isAdmin` from `useAuth()` — it is already destructured at line 12.
- Add a loading / error state for the delete operation:
  ```typescript
  const [deletingId, setDeletingId] = useState<number | null>(null);
  ```
- Add a `handleDelete` async function (outside JSX, inside the component):
  ```typescript
  async function handleDelete(a: Assessment) {
    if (!window.confirm(`Delete the assessment for "${a.vendor_name}"? This cannot be undone.`)) return;
    setDeletingId(a.id);
    try {
      await api.deleteAssessment(a.id);
      setAssessments((prev) => prev?.filter((x) => x.id !== a.id) ?? prev);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }
  ```
- In the table row's Actions `<td>` (currently line 156), add the Delete button **before** the `Open →` link, visible only when `isAdmin`:
  ```tsx
  <td className="px-4 py-3 text-right">
    <div className="flex items-center justify-end gap-3">
      {isAdmin && (
        <button
          className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
          onClick={() => handleDelete(a)}
          disabled={deletingId === a.id}
        >
          {deletingId === a.id ? 'Deleting…' : 'Delete'}
        </button>
      )}
      <Link to={`/assessments/${a.id}`} className="font-medium text-brand-700 hover:underline">
        Open<span className="sr-only"> {a.vendor_name} assessment</span> →
      </Link>
    </div>
  </td>
  ```

#### Step 6 — Add Delete action to ReviewWorkspace (`client/src/pages/ReviewWorkspace.tsx`)

- Import `useNavigate` from `'react-router-dom'` (currently only imports `Link` and `useParams`).
- Destructure `isAdmin` from `useAuth()` (currently line 20 only destructures `canEdit`, `canApprove`, `isSubmitterScope`).
- Add state and a const for navigate:
  ```typescript
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  ```
- Add a `handleDelete` async function:
  ```typescript
  async function handleDelete() {
    if (!window.confirm(`Delete the assessment for "${assessment.vendor_name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteAssessment(assessmentId);
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }
  ```
  Note: `assessment` is a const derived from `detail` — reference it only after the early-return guards (i.e., inside the JSX where `detail` is confirmed non-null). Either define `handleDelete` inline in JSX or use the `detail` state variable with a guard.
- In the `PageHeader` actions slot (around line 114), add the Delete button as the **first** action, visible only when `isAdmin`:
  ```tsx
  {isAdmin && (
    <button
      className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
      onClick={handleDelete}
      disabled={deleting}
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  )}
  ```

#### Step 7 — Run Verification commands

- Run all validation commands listed in the Verification section below.
- Fix any type errors or lint issues before marking complete.

## Key Decisions & Rationale

1. **Hard delete, not soft delete** — The issue explicitly states this is a hard delete with no restore/trash. Soft-delete is listed as out of scope.

2. **`requireAdmin` middleware on the route** — Applying the middleware at the route level (consistent with `/api/admin/*` routes) means non-admins receive a 403 before any business logic runs, and the error is returned by a single, well-tested code path.

3. **Scope-aware `deleteAssessment` returns `false` for unknown/out-of-scope ids** — This mirrors the pattern used by `getAssessment` and `patchAssessment`: cross-tenant access returns `undefined`/`false` → 404, never 403, so existence is not leaked. An admin in all-tenants mode can delete any assessment; an admin with a pinned tenant can only delete assessments in that tenant.

4. **Audit log entries for the deleted assessment are deleted too** — The issue explicitly requires this. This differs from the tenant-deletion pattern (which unlinks audit rows). The rationale: assessment audit entries are tightly scoped to the assessment and have no standalone value once the assessment is gone.

5. **New audit entry recorded AFTER the transaction** — The deletion audit entry uses `assessment_id: 0` (consistent with global admin actions like `tenant_deleted`, `user_deleted`) because the assessment row no longer exists. The vendor name and original id are preserved in `details`.

6. **Best-effort file unlink outside the transaction** — File-system operations are not transactional. Performing the unlink after the DB transaction commits means: if the unlink fails, the DB is still consistent (files are orphaned on disk but not referenced by the DB). Silently ignoring `ENOENT` handles the case where a file was already cleaned up.

7. **Optimistic UI removal on Dashboard** — After a successful delete, the row is filtered from `assessments` state immediately rather than re-fetching, for a faster perceived response. Errors restore the UI via the `error` state.

8. **Dashboard Actions cell layout** — The Delete button and `Open →` link are wrapped in a flex row (`flex items-center justify-end gap-3`) so they appear side-by-side, right-aligned, consistent with the existing right-aligned cell.

9. **`window.confirm` guard** — Per the issue, existing destructive actions in this app use `window.confirm`. No modal component is introduced to avoid scope creep and stay consistent with the codebase pattern.

## Verification

### Unit Tests & Edge Cases

The server has existing test infrastructure (`npm --prefix server test`). Add tests for:

- `DELETE /assessments/:id` returns 403 when called by a non-admin user.
- `DELETE /assessments/:id` returns 404 for a non-existent or out-of-scope id.
- `DELETE /assessments/:id` returns `{ deleted: true }` for a valid admin delete; the DB rows are gone.
- `deleteAssessment` cascades: after deletion, findings, questionnaire_items, evidence_files, and audit_log rows for the assessment are absent.
- A deletion audit entry is written (action = `'assessment_deleted'`).

### Acceptance Criteria

- [ ] An admin sees a `Delete` action on each Dashboard assessment row and in the assessment page header; non-admins (Analyst / Viewer / Submitter) see neither.
- [ ] `DELETE /assessments/:id` returns 403 for non-admins, 404 for an out-of-scope/unknown id, and `{ deleted: true }` on success.
- [ ] Deleting removes the assessment plus its `findings`, `questionnaire_items`, `evidence_files`, and `audit_log` rows; stored evidence files are unlinked best-effort.
- [ ] Both entry points prompt a `window.confirm` ("This cannot be undone.") before deleting.
- [ ] After deletion from Dashboard: the row disappears. After deletion from assessment page: user is navigated to `/` and the assessment is absent from the list.
- [ ] The delete action uses the existing red text-link styling (no new button variant).
- [ ] A deletion audit entry is recorded.
- [ ] `cd client && npm run build` and `npm --prefix server run typecheck` pass; server tests pass.

### Validation Commands

Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_admin_delete_assessment.md` to validate this functionality works.

```bash
# Biome lint + format check (run from repo root)
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# Server unit tests
npm --prefix server test

# Client production build (includes tsc --noEmit)
cd client && npm run build

# Full E2E suite (Playwright boots its own stack)
npm run test:e2e
```

## Known Limitations / Follow-ups

- **Bulk delete** is explicitly out of scope for this issue.
- **Soft-delete / restore** is explicitly out of scope; this is a hard delete.
- **Non-admin roles cannot delete** — per the issue spec, Analyst / Viewer / Submitter roles have no delete capability.
- **File unlink is best-effort** — if the server process lacks filesystem permissions or the file was already removed, the DB delete still succeeds silently. Orphaned uploads in `server/uploads/` would need a separate cleanup job.
- **All-tenants admin mode** — an admin operating in all-tenants mode (no pinned tenant) can delete any assessment regardless of tenant. This is intentional and consistent with the admin model, but operators should be aware.
