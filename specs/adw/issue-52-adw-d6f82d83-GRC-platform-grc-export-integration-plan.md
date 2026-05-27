# Spec — GRC-Platform Export / Integration

- **Status:** Draft
- **Branch:** d6f82d83-issue-52-adw-GRC-platform-grc-export-integration
- **Location:** `server/src/services/exporter.ts`, `server/src/routes/reports.ts`, `client/src/api/client.ts`, `client/src/pages/ReportView.tsx`, `server/test/api.integration.test.ts`, `.claude/commands/e2e/test_grc_export.md`, `API_CONTRACT.md`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md`, `API_CONTRACT.md`, `specs/0012-ux-tasks-harness.md`

## Problem / Objective

**User Story:** As an Analyst, I want to download the assessment report in a structured GRC-consumable JSON format, so that I can import it directly into a GRC platform (ServiceNow, Archer, OneTrust, or any other tool that accepts structured JSON).

**Problem Statement:** The existing exports (CSV, XLSX, browser PDF) are human-readable but lack a machine-consumable, semantically-rich format that GRC platforms can parse and import programmatically. A normalized JSON export that uses typed fields, structured framework mappings, and a versioned schema bridges this gap without requiring any third-party API keys or vendor-specific adapters.

The requirement from the Ines spec (Req 10) reads "Excel, PDF, **or** GRC platforms" — it is already satisfied via XLSX and PDF, but the GRC-JSON export is the cleanest forward-looking fulfilment and enables programmatic integrations.

## Approach & Changes

Add a new `GET /assessments/:id/export.json` endpoint that returns a structured, versioned JSON document. The JSON schema is designed to be:
- **Normalized** — nested objects instead of flat strings
- **Versioned** — top-level `schema_version` field to survive future shape changes
- **Typed** — all enum values match the TypeScript union types in `types.ts`
- **Complete** — includes assessment metadata, per-control findings with effective (analyst-overridden) values, summary statistics, deduplicated follow-up questions, and an AI-output disclaimer

No new npm dependencies are required. `JSON.stringify` is sufficient.

**Files and why they matter:**
- `server/src/services/exporter.ts` — add `toGrcJson(report: ReportData): string`; this is where all serialization lives, consistent with `toCsv` / `toXlsx`
- `server/src/routes/reports.ts` — add the new route; follows the exact same 5-line pattern as `export.csv` and `export.xlsx`
- `client/src/api/client.ts` — extend `exportUrl` to accept `'json'` as a format so the client can build the download URL without string concatenation
- `client/src/pages/ReportView.tsx` — add an "Export GRC JSON" `<a>` button next to the existing CSV and Excel buttons, matching the design-system `btn-secondary` style
- `server/test/api.integration.test.ts` — add integration test asserting the endpoint returns valid JSON with the expected shape
- `.claude/commands/e2e/test_grc_export.md` — new E2E test file to verify the button renders and the download triggers correctly

### New Files

- `.claude/commands/e2e/test_grc_export.md` — E2E test definition for the GRC JSON export button
- `API_CONTRACT.md` — add `GET /assessments/:id/export.json` row so the public API contract stays current

### Implementation Plan

**Phase 1 — Foundation (serializer)**
Implement `toGrcJson` in `exporter.ts`. The output schema:

```json
{
  "schema_version": "1.0",
  "disclaimer": "AI output is preliminary. Final vendor-risk decisions are made by a human analyst.",
  "vendor": "<vendor_name>",
  "assessment": {
    "questionnaire_type": "SIG",
    "date_submitted": "2025-01-15",
    "overall_risk": "High",
    "validation_status": "pending",
    "validated_by": null,
    "validated_at": null,
    "applicable_frameworks": ["ISO 27001", "GDPR"],
    "data_categories": ["personal"],
    "analyst_notes": null,
    "ai_engine": "claude",
    "mapping_version": "2026-05-fwmap-v2",
    "generated_at": "2026-05-27T..."
  },
  "summary": {
    "control_count": 150,
    "weak_or_missing_count": 12,
    "evidence_gap_count": 8,
    "follow_up_count": 6,
    "risk_distribution": { "Critical": 2, "High": 5, "Medium": 30, "Low": 113 }
  },
  "controls": [
    {
      "question_id": "SIG-1.1",
      "question_text": "...",
      "control_domain": "MFA",
      "vendor_response": "Yes",
      "response_type": "Yes",
      "framework_mappings": [{ "framework": "ISO 27001", "references": ["A.8.5"] }],
      "ai_finding": "...",
      "control_strength": "Strong",
      "completeness": "Complete",
      "evidence_sufficiency": "Sufficient",
      "risk_level": "Low",
      "analyst_status": "accepted",
      "follow_up_questions": [],
      "rationale": "..."
    }
  ],
  "follow_up_questions": ["...", "..."]
}
```

`effectiveFinding()` is called for each control so analyst-overridden values are used.

**Phase 2 — Core Implementation (route + client)**
Add the route and update the API client's `exportUrl` helper.

**Phase 3 — Integration (UI button + tests)**
Add the download button to `ReportView.tsx` and write both the integration test and the E2E test.

### Step by Step Tasks

#### Step 1 — Create the E2E test file
- Read `.claude/commands/test_e2e.md` and `.claude/commands/e2e/test_basic_assessment.md` to understand the E2E test format
- Create `.claude/commands/e2e/test_grc_export.md` with steps to:
  - Sign in as `analyst@acme.test` (Analyst role, Acme tenant)
  - Load the demo scenario and navigate to the report page of an analyzed assessment
  - Assert the "Export GRC JSON" button is visible in the toolbar
  - Click the button and assert a download is initiated (check `<a>` href points to `.json` URL)
  - Optionally take a screenshot of the ReportView toolbar showing all four export buttons

#### Step 2 — Implement `toGrcJson` in the exporter service
- In `server/src/services/exporter.ts`:
  - Import `effectiveFinding` (already imported for `toCsv` / `toXlsx`)
  - Add `toGrcJson(report: ReportData): string`
  - Build the JSON object as described in Phase 1 above
  - Compute `risk_distribution` by reducing over `report.controls`
  - Call `effectiveFinding(finding)` for each control to apply analyst overrides
  - Return `JSON.stringify(obj, null, 2)`

#### Step 3 — Add the route in `reports.ts`
- In `server/src/routes/reports.ts`:
  - Import `toGrcJson` alongside `toCsv` and `toXlsx`
  - Add `router.get('/assessments/:id/export.json', ...)` following the exact same 5-line pattern as the CSV route
  - Set `Content-Type: application/json; charset=utf-8`
  - Set `Content-Disposition: attachment; filename="<safeName>_grc_export.json"`
  - Return `res.send(json)`

#### Step 4 — Update the API client
- In `client/src/api/client.ts`:
  - Change the `exportUrl` function signature from `format: 'csv' | 'xlsx'` to `format: 'csv' | 'xlsx' | 'json'`
  - No other changes needed; the template literal already handles the extension

#### Step 5 — Add the export button to ReportView
- In `client/src/pages/ReportView.tsx`:
  - Add an `<a>` button for GRC JSON after the Excel button, before the Print/PDF button:
    ```tsx
    <a className="btn-secondary" href={api.exportUrl(assessmentId, 'json')}>
      Export GRC JSON
    </a>
    ```
  - No other layout changes needed; it joins the existing flex-wrap button row

#### Step 6 — Add integration tests
- In `server/test/api.integration.test.ts`:
  - Add a test that creates a full assessment with items + findings (follow the existing demo-load pattern), then calls `GET /api/assessments/:id/export.json`
  - Assert: HTTP 200, `Content-Type` contains `application/json`, response body is valid JSON
  - Assert: top-level keys `schema_version`, `vendor`, `assessment`, `summary`, `controls`, `follow_up_questions`, `disclaimer` all present
  - Assert: `summary.control_count` equals `controls.length`
  - Assert: each control entry has `question_id`, `control_domain`, `risk_level`, `framework_mappings` (array)
  - Assert: 404 returned for a nonexistent assessment id

#### Step 7 — Run validation commands
- Execute all validation commands listed in the Validation Commands section and confirm zero failures

## Key Decisions & Rationale

1. **JSON over a platform-specific format (ServiceNow, Archer):** A normalized JSON schema is universally ingestible without requiring API credentials to any external SaaS. Platform-specific adapters can be layered on top in a follow-up.

2. **`export.json` URL pattern over `/export?format=json`:** Consistent with the existing `.csv` and `.xlsx` routes. Easier to link to directly and set correct `Content-Disposition`.

3. **`effectiveFinding()` applied to every control:** The export must reflect the analyst's validated view, not the raw AI output. This is the same contract the CSV/XLSX use.

4. **`schema_version: "1.0"` in the root:** GRC importers need a stable version field to route deserialization. Starting at "1.0" keeps the door open for v2 without breaking existing integrations.

5. **`disclaimer` field in JSON root:** Mirrors the disclaimer already present in the CSV and XLSX exports; required by the app's "AI is preliminary, human decides" invariant.

6. **No new npm dependency:** `JSON.stringify` is sufficient. Adding a serialization library for a simple flat object would be unnecessary complexity.

7. **`btn-secondary` for the new button:** Matches the existing CSV and Excel export buttons exactly, as per the design system's button hierarchy.

## Verification

### Unit Tests & Edge Cases

- **Happy path:** assessment with multiple controls → valid JSON with correct counts
- **Analyst override:** a finding with `analyst_values` set → `toGrcJson` uses overridden values in the `controls` array
- **Empty controls:** assessment with zero items → `controls: []`, `summary.control_count: 0`
- **Risk distribution:** mix of all four risk levels → `risk_distribution` sums to `control_count`
- **Unauthenticated request:** 401 returned before `buildReport` is called
- **Non-existent assessment:** 404 returned
- **Invalid id:** 400 returned for non-numeric id

### Acceptance Criteria

- `GET /api/assessments/:id/export.json` returns HTTP 200 with `Content-Type: application/json` and a valid JSON body for an authenticated analyst
- The JSON body has top-level keys: `schema_version`, `disclaimer`, `vendor`, `assessment`, `summary`, `controls`, `follow_up_questions`
- `summary.control_count` equals `controls.length`
- Each control in `controls` has `framework_mappings` as an array of `{ framework, references }` objects (not a flat string)
- Analyst-overridden values are reflected (not raw AI values)
- `Content-Disposition` header sets filename to `<vendor_name>_grc_export.json`
- The "Export GRC JSON" button appears in the ReportView toolbar between the Excel and Print/PDF buttons
- Clicking the button triggers a file download in-browser
- All existing exports (CSV, XLSX, PDF) continue to work unchanged

### UX Scenarios, Acceptance & Evidence Checklist

**Affected route:** `/assessments/:id/report`

**Scenarios to cover:**

| Scenario | Viewports | Acceptance Criteria |
|---|---|---|
| ReportView toolbar: all four export buttons visible | Mobile 375, Tablet 768, Desktop 1280 | Buttons wrap cleanly with no overflow; all four buttons visible; no horizontal scroll at 375 px |
| "Export GRC JSON" button label readable | Desktop 1280 | Full label text visible; not clipped |
| Button focus ring | Desktop 1280 | Focus ring visible when tabbing to "Export GRC JSON" button |
| axe check | All viewports | No new serious/critical violations introduced by the new button |

**Before/after screenshots `/ux_validate` must capture:**
1. `report-toolbar-mobile-before` vs `report-toolbar-mobile-after` — mobile 375 px, full toolbar row, shows button wrapping
2. `report-toolbar-desktop-before` vs `report-toolbar-desktop-after` — desktop 1280 px, full toolbar row, shows all four buttons side by side

**UX tasks:**
- Extend `e2e/ux/scenarios.ts`: the existing `report` scenario already covers `/assessments/:id/report`. Add an `expectVisibleText` step asserting `"Export GRC JSON"` is visible on that route at all three viewports. Run `npm run test:ux` to confirm pass.

### Validation Commands

1. Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_grc_export.md` to validate the GRC export button and download work end-to-end.
2. `npm run check` — Biome lint + format check (run from repo root)
3. `npm run typecheck` — Server + client TypeScript type checks
4. `npm run test` — Server + client unit tests (includes new integration test)
5. `npm run build` — Client production build
6. `npm run test:ux` — UX regression suite (confirm `report` scenario now asserts "Export GRC JSON" visible)

## Known Limitations / Follow-ups

- **Platform-specific adapters not included.** ServiceNow, Archer, and OneTrust each have their own import schemas; mapping the GRC JSON to those formats is a follow-up task. The versioned `schema_version` field makes future adapters straightforward.
- **Audit log event not added.** The CSV and XLSX exports do not emit audit events either; if export tracking becomes a requirement, all three formats should be updated together.
- **No streaming for large assessments.** `JSON.stringify` materializes the full payload in memory. For very large assessments (thousands of controls), streaming serialization may be warranted — not a concern for current SIG questionnaire sizes (~150–300 controls).
