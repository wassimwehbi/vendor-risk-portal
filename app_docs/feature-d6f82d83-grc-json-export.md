# GRC JSON Export

**ADW ID:** d6f82d83
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/issue-d6f82d83-adw-GRC-platform-grc-export-integration-plan.md

## Overview

Adds a structured, versioned JSON export format (`export.json`) to the assessment report page, enabling analysts to download a machine-consumable GRC-platform-ready document. The export uses a normalized schema with typed fields, framework mappings, and analyst-overridden values, making it directly ingestible by platforms such as ServiceNow, Archer, and OneTrust without requiring any third-party API keys.

## What Was Built

- `toGrcJson()` serializer in the exporter service producing a versioned JSON schema
- `GET /api/assessments/:id/export.json` endpoint with correct `Content-Type` and `Content-Disposition` headers
- `exportUrl` API client helper extended to accept `'json'` as a format
- "Export GRC JSON" button in the ReportView toolbar alongside the existing CSV, Excel, and Print/PDF buttons
- Integration tests covering the happy path, 404 for nonexistent assessment, and 401 for unauthenticated requests
- E2E test definition (`.claude/commands/e2e/test_grc_export.md`) for button visibility and download verification
- UX scenario extension to assert "Export GRC JSON" text is visible on the report route

## Technical Implementation

### Files Modified

- `server/src/services/exporter.ts`: Added `toGrcJson(report: ReportData): string` — builds the versioned JSON object, computes risk distribution, applies `effectiveFinding()` per control, and returns `JSON.stringify(obj, null, 2)`
- `server/src/routes/reports.ts`: Added `GET /assessments/:id/export.json` route following the same 5-line pattern as the CSV and XLSX routes; sets `Content-Disposition` with `<vendor_name>_grc_export.json` filename
- `client/src/api/client.ts`: Extended `exportUrl` signature from `'csv' | 'xlsx'` to `'csv' | 'xlsx' | 'json'`
- `client/src/pages/ReportView.tsx`: Added `<a className="btn-secondary">Export GRC JSON</a>` after the Excel button
- `server/test/api.integration.test.ts`: Added three integration tests (shape validation, 404, 401)
- `e2e/ux/scenarios.ts`: Added `expectVisibleText` step asserting "Export GRC JSON" is visible on the report route

### Key Changes

- `effectiveFinding()` is called for every control so analyst-overridden values — not raw AI output — appear in the export
- Top-level `schema_version: "1.0"` field enables GRC importers to route deserialization and supports future schema evolution without breaking existing integrations
- `disclaimer` field mirrors the CSV/XLSX exports, enforcing the app's "AI is preliminary, human decides" contract
- `framework_mappings` is serialized as a structured array of `{ framework, references }` objects rather than a flat string, enabling programmatic filtering by framework
- Risk distribution is computed in a single reduce pass over `controls`, producing `{ Critical, High, Medium, Low }` counts alongside the aggregate `summary`

## How to Use

1. Navigate to any analyzed assessment's report page (`/assessments/:id/report`).
2. In the toolbar, click **Export GRC JSON**.
3. The browser downloads `<vendor_name>_grc_export.json`.
4. Import the file into your GRC platform (ServiceNow, Archer, OneTrust, or any tool that accepts structured JSON).

The downloaded JSON follows this top-level schema:

```json
{
  "schema_version": "1.0",
  "disclaimer": "AI output is preliminary. Final vendor-risk decisions are made by a human analyst.",
  "vendor": "<vendor_name>",
  "assessment": { "questionnaire_type", "date_submitted", "overall_risk", ... },
  "summary": { "control_count", "weak_or_missing_count", "evidence_gap_count", "follow_up_count", "risk_distribution" },
  "controls": [ { "question_id", "framework_mappings", "risk_level", "analyst_status", ... } ],
  "follow_up_questions": [ "..." ]
}
```

## Configuration

No configuration required. The endpoint is authenticated (session cookie only — CSRF token is not required for GET requests; CSRF remains enforced for all state-changing methods) and scoped to the requesting user's tenant. No new npm dependencies were added.

## Testing

- **Integration tests:** `npm --prefix server test` — covers shape validation, 404 for nonexistent assessment, and 401 for unauthenticated access
- **Type checks:** `npm run typecheck`
- **Lint/format:** `npm run check`
- **Client build:** `cd client && npm run build`
- **UX regression:** `npm run test:ux` — the `report` scenario now asserts "Export GRC JSON" is visible
- **E2E:** run `.claude/commands/e2e/test_grc_export.md` via `/e2e:test_grc_export` to verify button render and download trigger end-to-end

## Notes

- **AI output is preliminary.** The `disclaimer` field in the exported JSON reinforces that all vendor-risk decisions are made by a human analyst, never automatically by the AI.
- **Platform-specific adapters not included.** ServiceNow, Archer, and OneTrust each have proprietary import schemas; mapping this GRC JSON to those formats is a planned follow-up. The `schema_version` field makes future adapters straightforward.
- **No audit log event.** CSV and XLSX exports also lack audit events; if export tracking becomes a requirement, all three formats should be updated together.
- **No streaming.** `JSON.stringify` materializes the full payload in memory. For very large assessments (thousands of controls), streaming serialization may be warranted — not a concern for current SIG questionnaire sizes (~150–300 controls).
