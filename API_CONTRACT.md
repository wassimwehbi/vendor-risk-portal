# API Contract

Base path: `/api`. All responses use the envelope `{ success: boolean, data?: T, error?: string }`.
All requests may include headers `X-Analyst: <name>` and `X-Role: Analyst|Admin|Viewer` (default `Analyst`).
Viewers are read-only (mutating endpoints return `403`).

| Method | Path | Body / params | Returns |
| ------ | ---- | ------------- | ------- |
| GET  | `/health` | — | `{ status, aiEngineAvailable }` |
| GET  | `/vendors` | — | `Vendor[]` |
| GET  | `/assessments` | — | `Assessment[]` (with `item_count`, `finding_count`) |
| POST | `/assessments` | `{ vendor_name, questionnaire_type, date_submitted }` | `Assessment` (201) |
| GET  | `/assessments/:id` | — | `{ assessment, items, findings, evidence }` |
| POST | `/assessments/:id/upload` | multipart: `questionnaire` (1 file: xlsx/xls/csv), `evidence` (0..20 files: PDF/Word/CSV/Excel/image — others ⇒ `422`; 25 MB each) | `{ assessment, items, evidence }` |
| POST | `/assessments/:id/analyze` | — | `AnalyzeResult` `{ engine, overall_risk, data_categories, applicable_frameworks, findings }` |
| PATCH | `/findings/:id` | `{ control_domain?, framework_mappings?, risk_level?, evidence_sufficiency?, follow_up_questions?, analyst_status? }` | `Finding` |
| PATCH | `/assessments/:id` | `{ overall_risk?, analyst_notes?, validation_status? }` (`approved` ⇒ role Analyst/Admin) | `Assessment` |
| GET  | `/assessments/:id/report` | — | `ReportData` (12-field analyst report) |
| GET  | `/assessments/:id/export.csv` | — | CSV download |
| GET  | `/assessments/:id/export.xlsx` | — | Excel download |
| GET  | `/assessments/:id/audit` | — | `AuditEntry[]` |
| GET  | `/demo/scenarios` | — | `ScenarioSummary[]` |
| POST | `/demo/scenarios/:key/load` | — | `Assessment` (201, status `extracted`) |

Type definitions are the source of truth in `server/src/types.ts` (mirrored in `client/src/types.ts`).

### Evidence files

Uploaded evidence is type-checked against an allow-list (**PDF, Word `.doc`/`.docx`, CSV,
Excel `.xls`/`.xlsx`, images PNG/JPG/GIF/WebP/BMP/TIFF**); unsupported types are rejected with
`422`. Each accepted file is parsed on upload and the `EvidenceFile` carries: `kind`
(`pdf|word|excel|csv|image|unknown`), `parse_status`
(`extracted|no_text|empty|unsupported|error`), `extracted_chars`, `extracted_text` (capped),
and a human-readable `parse_note`. Text is extracted from PDF/Word/CSV/Excel; images are stored
with dimensions but not OCR'd (`no_text`); legacy `.doc` is accepted but not text-extracted
(`unsupported`).

### Analyst overrides

A `Finding` carries AI values plus an optional `analyst_values` object holding overrides for
`control_domain`, `framework_mappings`, `risk_level`, `evidence_sufficiency`, `follow_up_questions`.
`analyst_status` is `pending | accepted | overridden`. The effective (displayed) value is the override
when present, otherwise the AI value (see `effectiveFinding`).
