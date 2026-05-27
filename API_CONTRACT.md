# API Contract

Base path: `/api`. All responses use the envelope `{ success: boolean, data?: T, error?: string }`.

**Authentication:** every endpoint except `/health` and `/auth/*` requires an authenticated
session (cookie `vrp.sid`); unauthenticated requests return `401`. Requests must be made with
credentials (cookies). **CSRF:** state-changing requests (POST/PATCH/...) must send the
`x-csrf-token` header (value from `GET /auth/session`); otherwise `403`. **Roles** are derived
server-side from the user record (not the client): Viewers are read-only (`403` on mutations);
only Analyst/Admin can approve.

### Auth endpoints (`/api/auth`, public)

| Method | Path | Body / params | Returns |
| ------ | ---- | ------------- | ------- |
| GET  | `/auth/session` | — | `{ user: SessionUser \| null, csrfToken: string \| null }` |
| GET  | `/auth/providers` | — | `{ google, microsoft, email, dev }` (which methods are enabled) |
| GET  | `/auth/google` · `/auth/microsoft` | — | 302 redirect to the provider (if configured) |
| GET  | `/auth/{google,microsoft}/callback` | OAuth params | 302 back to `CLIENT_ORIGIN` (sets session) |
| POST | `/auth/magic/request` | `{ email }` | `{ sent: true, devLink? }` (generic; `devLink` only in dev) |
| GET  | `/auth/magic/verify` | `?token=` | 302 back to `CLIENT_ORIGIN` (sets session) |
| POST | `/auth/dev-login` | `{ email, role?, name? }` (only when `AUTH_MODE=dev`) | `{ user, csrfToken }` |
| POST | `/auth/signout` | — | `{ signedOut: true }` |

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
| GET  | `/assessments/:id/export.json` | — | GRC-consumable JSON download (`Content-Disposition: attachment`). Body: `{ schema_version, disclaimer, vendor, assessment, summary, controls[], follow_up_questions[] }`. Analyst overrides applied via `effectiveFinding`. |
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
