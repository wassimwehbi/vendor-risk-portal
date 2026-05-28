# Spec — Add a Distinct "Business Context" Field

- **Status:** Draft
- **Branch:** feat-issue-51-adw-e7ebb162-add-business-context-field
- **Location:** `server/src/db.ts`, `server/src/types.ts`, `server/src/routes/review.ts`, `server/src/services/store.ts`, `server/src/services/exporter.ts`, `client/src/types.ts`, `client/src/api/client.ts`, `client/src/pages/ReviewWorkspace.tsx`, `client/src/pages/ReportView.tsx`, `server/test/api.integration.test.ts`, `API_CONTRACT.md`, `e2e/ux/scenarios.ts`, `.claude/commands/e2e/test_business_context.md`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md`, `specs/0012-ux-tasks-harness.md`, `specs/0014-design-system.md`, `API_CONTRACT.md`

## Problem / Objective

**User Story:** As an Analyst, I want to record business context for a vendor assessment in a dedicated field — separate from my review notes — so that readers of the report can immediately understand the business rationale and risk appetite that informed the review, without it being buried alongside operational notes.

**Problem Statement:** The Ines spec (Req 7) calls for analysts to "add business context" as a distinct capability. Currently there is no dedicated `business_context` field; the placeholder text `"Add business context…"` is used on the shared `analyst_notes` textarea (`client/src/pages/ReviewWorkspace.tsx:467-473`). Combining the two kinds of content in a single field makes it impossible to display or export them separately, and conflates the human-readable rationale for why a vendor was accepted/rejected with operational review notes. Adding a discrete `business_context` column — stored, audited, and exported independently — satisfies Req 7 cleanly.

## Approach & Changes

Add a `business_context TEXT` column to the `assessments` table and thread it through every layer of the stack that already handles `analyst_notes`, following the exact same pattern.

**Files and why they matter:**
- `server/src/db.ts` — schema source of truth; must add the column to the CREATE TABLE block and call `ensureColumn()` so existing databases are migrated on startup without data loss
- `server/src/types.ts` — `Assessment` and `ReportData` interfaces must expose the new field so TypeScript strict mode is satisfied end-to-end
- `server/src/routes/review.ts` — the Zod validation schema for `PATCH /assessments/:id` must accept `business_context`
- `server/src/services/store.ts` — `patchAssessment()` must write the field; `buildReport()` must include it in the returned `ReportData`; audit logging is automatic (details captures the full patch object)
- `server/src/services/exporter.ts` — the CSV, XLSX (Summary sheet), and GRC JSON exports must include the new field alongside `analyst_notes`
- `client/src/types.ts` — mirror the server-side `Assessment` and `Report` interfaces
- `client/src/api/client.ts` — extend the `patchAssessment` body type to accept `business_context`
- `client/src/pages/ReviewWorkspace.tsx` — add a distinct labeled textarea above `analyst_notes`; save it via the existing `patchAssessment` call
- `client/src/pages/ReportView.tsx` — render a "Business context" section in the report distinct from "Analyst notes"
- `server/test/api.integration.test.ts` — integration tests for the new field
- `API_CONTRACT.md` — update the `PATCH /assessments/:id` and `GET /assessments/:id/report` rows
- `e2e/ux/scenarios.ts` — extend the `review` and `report` UX scenarios

### New Files

- `.claude/commands/e2e/test_business_context.md` — E2E test definition; validates the field is visible, saveable, and appears in the report

### Implementation Plan

**Phase 1 — Foundation (DB + types + API)**
Add the `business_context TEXT` column to the DB schema and all type definitions; extend the server-side Zod schema and `patchAssessment` / `buildReport` functions; update exports (CSV, XLSX, GRC JSON) and the `API_CONTRACT.md`.

**Phase 2 — Core Implementation (UI)**
Add the distinct "Business context" textarea to `ReviewWorkspace.tsx`; render the new section in `ReportView.tsx`. Wire state management and the save call following the exact same pattern as `analyst_notes`.

**Phase 3 — Integration (tests + UX scenarios)**
Write the integration test, the E2E test file, and extend the UX scenario manifest. Run all validation commands to confirm zero regressions.

### Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

#### Step 1 — Create the E2E test file

- Read `.claude/commands/test_e2e.md` and `.claude/commands/e2e/test_basic_assessment.md` to understand the E2E test format and seed data available
- Create `.claude/commands/e2e/test_business_context.md` with steps to:
  - Sign in as `analyst@acme.test` (Analyst role, Acme tenant)
  - Load the demo scenario and navigate to the ReviewWorkspace of an analyzed assessment
  - Confirm a "Business context" textarea is visible and distinct from the "Analyst notes" textarea (assert both exist with different `id` attributes)
  - Type a sample business context string into the textarea and click "Save business context"
  - Confirm the save succeeds (button re-enables, no error banner)
  - Navigate to the report page for the same assessment
  - Confirm the "Business context" section appears in the report and contains the saved text
  - Take a screenshot of the ReviewWorkspace showing both textareas and a screenshot of the report section

#### Step 2 — Extend the database schema

- In `server/src/db.ts`:
  - Add `business_context TEXT` to the `assessments` CREATE TABLE block (after the `analyst_notes` column, for readability; both are nullable TEXT)
  - Add a call to `ensureColumn('assessments', 'business_context', 'TEXT')` in `initDb()` immediately after the existing `ensureColumn` calls — this migrates existing databases on startup with no downtime

#### Step 3 — Update server-side types

- In `server/src/types.ts`:
  - Add `business_context: string | null` to the `Assessment` interface (after `analyst_notes`)
  - Add `business_context: string | null` to the `ReportData` interface (after `analyst_notes`)

#### Step 4 — Extend the PATCH route schema

- In `server/src/routes/review.ts`:
  - Add `business_context: z.string().optional()` to the `assessmentSchema` Zod object (after the `analyst_notes` line)
  - No other route changes needed; the existing authorization and tenant-scope guards already apply to all patched fields

#### Step 5 — Update `patchAssessment` and `buildReport` in store.ts

- In `server/src/services/store.ts`:
  - In `patchAssessment()`: add `business_context` to the list of patchable fields, following the exact same conditional-push pattern used for `analyst_notes` (add a column to the SQL SET clause when the field is present in the request body)
  - In `buildReport()`: include `business_context: assessment.business_context` in the returned `ReportData` object (after `analyst_notes`)
  - Audit logging requires no change — the existing `logAudit` call already records the full patch body in its `details` JSON field

#### Step 6 — Update exports in exporter.ts

- In `server/src/services/exporter.ts`:
  - `toCsv()`: add a `Business context` meta row immediately after the `Analyst notes` row, following the same `[ 'Business context', report.business_context ?? '' ]` pattern
  - `toXlsx()`: add a `Business context` row to the Summary sheet immediately after `Analyst notes`
  - `toGrcJson()`: add `business_context: report.business_context` to the `assessment` object immediately after `analyst_notes`

#### Step 7 — Update client-side types

- In `client/src/types.ts`:
  - Add `business_context: string | null` to the `Assessment` interface (after `analyst_notes`)
  - Add `business_context: string | null` to any `Report` or `ReportData` interface that mirrors `analyst_notes`

#### Step 8 — Extend the API client

- In `client/src/api/client.ts`:
  - Add `business_context?: string` to the body type of `patchAssessment` (after `analyst_notes`)
  - No URL or method changes needed

#### Step 9 — Add the Business context textarea to ReviewWorkspace

- In `client/src/pages/ReviewWorkspace.tsx`:
  - Add a `businessContext` state variable (mirroring the existing `notes` state): `const [businessContext, setBusinessContext] = useState('')`
  - Add a `savingBusinessContext` boolean state (mirroring `savingNotes`)
  - In the `useEffect` that loads assessment data, initialise `businessContext` from `d.assessment.business_context ?? ''`
  - Add a `saveBusinessContext` handler that calls `api.patchAssessment(assessmentId, { business_context: businessContext })`, following the exact same pattern as `saveNotes`
  - In the JSX, inside the `analyzed && canEdit` guard block, add a new labeled section **above** the existing "Analyst notes" section:
    - Label: `"Business context"` (matching the design-system `label` utility class)
    - Textarea: `id="business-context"`, same Tailwind classes as the analyst-notes textarea, `placeholder="Describe the business rationale and risk appetite context for this assessment…"`, `disabled={!canEdit || savingBusinessContext}`, `value={businessContext}`, `onChange`
    - Save button: `"Save business context"` (using `btn-primary` class matching the existing save button pattern), `disabled` and loading state when `savingBusinessContext`
  - The two sections remain visually separate (each with its own heading + textarea + save button); they are not merged into a single form submit

#### Step 10 — Render Business context in ReportView

- In `client/src/pages/ReportView.tsx`:
  - Add a "Business context" section above the existing "Analyst notes" section in the report body
  - Use the same heading level, `whitespace-pre-wrap` styling, and fallback text pattern: `"No business context added."`
  - The section is always rendered (for analysts and stakeholders reading the report) so it appears even when empty, signaling the field exists

#### Step 11 — Update API_CONTRACT.md

- In `API_CONTRACT.md`:
  - Add `business_context` to the `PATCH /assessments/:id` request body table (optional string)
  - Add `business_context` to the `Assessment` response shape and `ReportData` shape descriptions

#### Step 12 — Add integration tests

- In `server/test/api.integration.test.ts`:
  - Add a test: PATCH `/assessments/:id` with `{ business_context: "Test business context" }` → assert HTTP 200, returned assessment contains `business_context: "Test business context"`
  - Add a test: GET `/assessments/:id/report` after setting `business_context` → assert `report.business_context` matches saved value
  - Add a test: GET `/assessments/:id/export.json` (if GRC export exists) → assert `assessment.business_context` is present in the JSON
  - Edge case: PATCH with `business_context: ""` (clear it) → assert field is updated to empty string
  - Edge case: PATCH with `business_context` absent → assert existing value is unchanged

#### Step 13 — Extend UX scenarios

- In `e2e/ux/scenarios.ts`:
  - In the `review` scenario: add an `expectVisible` step asserting the `#business-context` textarea is present at the three standard viewports (375, 768, 1280)
  - In the `report` scenario: add an `expectVisibleText` step asserting `"Business context"` heading text is present at all three viewports

#### Step 14 — Run all validation commands

- Execute every command in the Validation Commands section in order and confirm zero failures

## Key Decisions & Rationale

1. **Separate field, not a UI-only label:** A distinct DB column ensures `business_context` and `analyst_notes` are independently queryable, exportable, and auditable. Relabeling the placeholder text would satisfy nothing; the data must be separate at the persistence layer.

2. **Separate save button, not a combined save:** Following the existing pattern (analyst notes has its own Save button), keeping the saves independent avoids inadvertent overwrites when only one field has changed and matches the existing user mental model.

3. **Business context displayed above analyst notes:** Business context is broader and more audience-facing (stakeholders read it to understand the decision framing), while analyst notes are operational. Displaying the broader field first matches reading priority.

4. **No new npm dependency:** The entire change threads through the existing PATCH / read / export pipeline. No serialization library, migration framework, or form library is needed.

5. **Always render in ReportView even when empty:** Showing the section header with "No business context added." signals to report consumers that the field exists and was intentionally left empty, rather than being a missing feature.

6. **`ensureColumn()` for migration:** The existing lightweight migration pattern avoids a migration framework dependency while safely backfilling production databases that lack the column on startup.

7. **Audit trail is free:** `logAudit` already records the full patch body. Any `business_context` write is automatically captured under the `assessment_updated` action without additional code.

## Verification

### Unit Tests & Edge Cases

- **Happy path:** PATCH with `business_context` → stored and returned correctly
- **Independent patch:** PATCH with only `analyst_notes` → `business_context` unchanged; PATCH with only `business_context` → `analyst_notes` unchanged
- **Empty string:** PATCH with `business_context: ""` → field updated to empty string (not null)
- **Report includes field:** `buildReport()` always includes `business_context` in the returned object even if null
- **Export includes field:** CSV, XLSX, and GRC JSON all include the field
- **Unauthenticated request:** 401 before any field is read or written
- **Non-analyst/admin:** 403 for Viewer role attempting PATCH

### Acceptance Criteria

- `PATCH /api/assessments/:id` accepts `business_context` (optional string) and persists it independently of `analyst_notes`
- `GET /api/assessments/:id` returns `business_context` in the assessment object
- `GET /api/assessments/:id/report` returns `business_context` in the report data
- The ReviewWorkspace shows a distinct "Business context" labeled textarea with its own "Save business context" button, visually separate from the "Analyst notes" section
- Saving business context does not overwrite analyst notes and vice versa
- The report page shows a "Business context" section above "Analyst notes" at all viewports
- CSV, XLSX, and GRC JSON exports include a `Business context` row/field
- Audit log captures `business_context` changes in the `details` JSON of `assessment_updated` events
- All existing analyst-notes functionality is unchanged

### UX Scenarios, Acceptance & Evidence Checklist

**Affected routes:** `/assessments/:id` (ReviewWorkspace), `/assessments/:id/report` (ReportView)

**Scenarios to cover:**

| Scenario | Viewports | Acceptance Criteria |
|---|---|---|
| ReviewWorkspace: both textareas visible and labeled | Mobile 375, Tablet 768, Desktop 1280 | Both "Business context" and "Analyst notes" labeled textareas are visible; no horizontal overflow; correct vertical stacking |
| ReviewWorkspace: business-context textarea is interactable | Desktop 1280 | Textarea accepts input; Save button enables on focus; focus ring visible |
| ReportView: Business context section present | Mobile 375, Tablet 768, Desktop 1280 | "Business context" heading and content (or fallback) are visible; section appears above "Analyst notes" |
| axe clean | All viewports | No new serious/critical violations introduced by the new textareas or section headings |

**Before/after screenshots `/ux_validate` must capture:**
1. `review-analyst-section-mobile-before` vs `review-analyst-section-mobile-after` — mobile 375 px, analyst decision section, shows both textareas stacked
2. `review-analyst-section-desktop-before` vs `review-analyst-section-desktop-after` — desktop 1280 px, analyst decision section, shows both textareas side-by-side or stacked
3. `report-context-section-desktop-before` vs `report-context-section-desktop-after` — desktop 1280 px, report page, shows the new "Business context" section above "Analyst notes"

**UX tasks:**
- Extend `e2e/ux/scenarios.ts`: add `expectVisible` for `#business-context` textarea to the `review` scenario at viewports 375, 768, 1280; add `expectVisibleText` for heading `"Business context"` to the `report` scenario at all three viewports. Run `npm run test:ux` to confirm pass.

### Validation Commands

1. Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_business_context.md` to validate the field saves and appears in the report end-to-end.
2. `npm run check` — Biome lint + format check (run from repo root)
3. `npm run typecheck` — Server + client TypeScript type checks
4. `npm run test` — Server + client unit tests (includes new integration tests)
5. `npm run build` — Client production build
6. `npm run test:ux` — UX regression suite (confirm `review` and `report` scenarios pass with new assertions)

## Known Limitations / Follow-ups

- **Search / filter not in scope:** The `business_context` field is not indexed or searchable in the assessments list. If analysts need to search by context text in a future iteration, a full-text index can be added.
- **No character limit enforced:** Consistent with `analyst_notes`, no max-length constraint is applied. A future UX iteration may add a character counter.
- **PDF print not explicitly tested:** The ReportView "Business context" section will appear in browser-print / PDF via the existing CSS `@media print` rules; no changes to print styles are required, but explicit print testing is deferred to a follow-up.
