# Spec — Parse Word & PDF questionnaires (not only Excel/CSV)

- **Status:** Draft
- **Branch:** feat-issue-44-adw-5c55fbae-parse-word-pdf-questionnaires
- **Location:** `server/src/services/extraction.ts`, `server/src/routes/upload.ts`, `client/src/pages/NewAssessment.tsx`, `server/test/extraction.test.ts`, `API_CONTRACT.md`, `.claude/commands/e2e/test_word_pdf_questionnaire.md`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md` (§ Intake), `README.md` (Supported formats), `API_CONTRACT.md` (POST /assessments/:id/upload)

## Problem / Objective

**User Story:** As an analyst, I want to upload a SIG questionnaire as a Word (.docx) or PDF file so that I don't have to convert it to Excel first — saving time and reducing the risk of data loss during format conversion.

**Problem Statement:** `parseQuestionnaire` in `server/src/services/extraction.ts` only calls `XLSX.read`, so any non-spreadsheet questionnaire (Word or PDF) parses to zero rows and is rejected with a 422 at `server/src/routes/upload.ts:101-108`. Per Ines Req 3A, SIG intake must accept Excel, Word, and PDF. Both `pdf-parse` and `mammoth` are already in `server/package.json` — no new dependencies are required.

## Approach & Changes

The fix is contained to the server-side parsing layer and the client upload form. The downstream pipeline (`replaceItems`, `analyzeAssessment`, AI providers, rule engine) remains unchanged because it consumes `NewQuestionnaireItem[]` regardless of source format.

**Files and why they matter:**
- `server/src/services/extraction.ts` — owns `parseQuestionnaire`; add DOCX and PDF dispatchers here; the function signature must change from sync to `async` to accommodate `mammoth` and `pdf-parse`.
- `server/src/routes/upload.ts` — single call site of `parseQuestionnaire`; needs one `await`.
- `client/src/pages/NewAssessment.tsx` — file input `accept` attribute and label text are hardcoded to `.xlsx,.xls,.csv`; must be updated to include `.docx,.pdf`.
- `server/test/extraction.test.ts` — existing tests cover `parseRows` (pure sync helper, unchanged); new tests cover the async dispatchers.
- `API_CONTRACT.md` — documents accepted questionnaire MIME types for integrators.

### New Files
- `.claude/commands/e2e/test_word_pdf_questionnaire.md` — E2E test plan for Word/PDF upload flow.

### Implementation Plan

**Phase 1 — Foundation**
Make `parseQuestionnaire` async and split into format-specific helpers. The XLSX path becomes a thin wrapper around the existing sync logic (no behaviour change). Two new async helpers are introduced: `parseDocxQuestionnaire` and `parsePdfQuestionnaire`.

**Phase 2 — Core Implementation**

_DOCX_: Use `mammoth.convertToHtml({ buffer })` to preserve Word table structure as HTML. Parse `<tr>` blocks and extract cell text (stripping inner tags) to build `Record<string, unknown>[]` rows, then feed into the existing `parseRows()`. If no table is found, throw with a descriptive message.

_PDF_: Use `pdf-parse(buffer)` for raw text extraction, then apply two heuristics in priority order:
1. **Tab-separated** — if ≥ 3 lines contain tabs, parse as TSV with the first tab-containing line as the header.
2. **Multi-space column alignment** — split lines on 2+ consecutive spaces (`/\s{2,}/`) to detect whitespace-aligned columns; validate consistency across ≥ 3 rows before committing.

If both heuristics yield zero items, throw a 422-friendly error directing the user to prefer `.xlsx` or `.docx`.

**Phase 3 — Integration**
Update the `upload.ts` call site (add `await`). Update the React upload form to accept `.docx` and `.pdf`. Update the API contract.

### Step by Step Tasks

#### 1. Read existing code before editing
- Read `server/src/services/extraction.ts` (already reviewed)
- Read `server/src/routes/upload.ts` lines 97-113 (the questionnaire parse block)
- Read `server/test/extraction.test.ts` (understand existing test patterns)
- Read `.claude/commands/test_e2e.md` and `.claude/commands/e2e/test_basic_assessment.md` (E2E format reference)

#### 2. Make `parseQuestionnaire` async and add DOCX parser in `extraction.ts`
- Add `import mammoth from 'mammoth'` at the top of `extraction.ts`
- Add `import { readFile } from 'node:fs/promises'` (replace `readFileSync`)
- Add private helper `parseCellsFromHtml(rowHtml: string): string[]`:
  - Regex-match all `<t[dh]>…</t[dh]>` cells
  - Strip inner HTML tags, decode `&amp;`, `&lt;`, `&gt;`, `&nbsp;`
  - Return trimmed strings
- Add `export async function parseDocxQuestionnaire(buffer: Buffer): Promise<NewQuestionnaireItem[]>`:
  - `const { value: html } = await mammoth.convertToHtml({ buffer })`
  - Match all `<tr[^>]*>…</tr>` blocks
  - Find the first group of rows that has a header row matching ≥ 1 ALIASES key
  - Build `Record<string, unknown>[]` from (header, cells) pairs
  - Call `parseRows(rows)`
  - If no table found or `parseRows` returns zero items: `throw new Error('No parseable table found in Word document. Ensure the questionnaire uses a table with column headers.')`

#### 3. Add PDF parser in `extraction.ts`
- Add `import pdfParse from 'pdf-parse'`
- Add `export async function parsePdfQuestionnaire(buffer: Buffer): Promise<NewQuestionnaireItem[]>`:
  - `const { text } = await pdfParse(buffer)`
  - Split text into non-empty trimmed lines
  - **Heuristic 1 (tab-separated):** count lines containing `\t`; if ≥ 3, take first tab-line as header, parse all tab-lines as TSV, call `parseRows`; return if `items.length > 0`
  - **Heuristic 2 (multi-space):** split each line on `/\s{2,}/`; validate that the first matching line has ≥ 2 columns and ≥ 2 subsequent lines share the same column count; treat first as header and remainder as data; call `parseRows`; return if `items.length > 0`
  - If nothing worked: `throw new Error('Could not detect table structure in PDF. For reliable parsing, export the questionnaire as .xlsx or .docx.')`

#### 4. Update `parseQuestionnaire` dispatcher in `extraction.ts`
- Change signature: `export async function parseQuestionnaire(filePath: string, originalName: string): Promise<NewQuestionnaireItem[]>`
- Replace `readFileSync` with `await readFile(filePath)`
- Detect format from `originalName` extension (lowercased):
  - `.pdf` → `parsePdfQuestionnaire(buf)`
  - `.docx` or `.doc` → `parseDocxQuestionnaire(buf)`
  - `.xlsx`, `.xls`, `.xlsm`, `.csv` (default) → existing XLSX.read path (kept sync, wrapped in the now-async function)
- Remove `readFileSync` import

#### 5. Update `upload.ts` call site
- Change `const parsed = parseQuestionnaire(…)` → `const parsed = await parseQuestionnaire(…)` (the surrounding function is already `async`)
- No other changes needed

#### 6. Update client upload form in `NewAssessment.tsx`
- Line 42 validation message: `'Please choose a SIG questionnaire file (.xlsx, .xls, .csv).'` → `'Please choose a SIG questionnaire file (.xlsx, .xls, .csv, .docx, or .pdf).'`
- Line 109 label: `SIG questionnaire (.xlsx, .xls, .csv)` → `SIG questionnaire (.xlsx, .xls, .csv, .docx, .pdf)`
- Line 114 `accept` attribute: `".xlsx,.xls,.csv"` → `".xlsx,.xls,.csv,.docx,.pdf"`

#### 7. Update `API_CONTRACT.md`
- In the `POST /assessments/:id/upload` section, update the questionnaire file types to include `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`) and `application/pdf` (`.pdf`)

#### 8. Write / extend unit tests in `server/test/extraction.test.ts`
- Test `parseDocxQuestionnaire` with a minimal synthetic HTML string containing a `<table>` (construct the Buffer from a known mammoth output string — avoid needing a real DOCX fixture by mocking mammoth or using a real tiny DOCX buffer)
- Test `parsePdfQuestionnaire` with a tab-delimited text mock (mock `pdf-parse` to return a known `text` value)
- Test `parsePdfQuestionnaire` with a multi-space-aligned text mock
- Test that `parsePdfQuestionnaire` throws when no structure is found
- Test that `parseQuestionnaire` dispatches correctly by extension (`.pdf` → PDF path, `.docx` → DOCX path, `.xlsx` → XLSX path)
- Verify all existing `parseRows` tests still pass (they are unchanged)

#### 9. Create E2E test plan file
- Create `.claude/commands/e2e/test_word_pdf_questionnaire.md` describing steps to:
  1. Create a new assessment
  2. Upload a `.docx` questionnaire (use a generated or checked-in fixture)
  3. Verify items are extracted and assessment moves to `analyzed` status
  4. Repeat with a `.pdf` questionnaire
  5. Verify that uploading an unsupported type returns a 422 error message in the UI

#### 10. Run validation commands
- Execute all validation commands listed in the Verification section below

## Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| `parseQuestionnaire` becomes `async` | Both `mammoth` and `pdf-parse` are Promise-based; wrapping them in sync is an anti-pattern. The single call site in `upload.ts` is already `async`, so the change is trivial. |
| PDF heuristics rather than a proper PDF table library | No new server dependency. Covers the common SIG PDF export patterns (tab-separated or whitespace-aligned) without adding complexity. A clear 422 guides users to better formats when heuristics fail. |
| DOCX via mammoth HTML rather than raw XML | `mammoth` is already a dependency and its HTML output has reliable `<table>` structure. Parsing raw DOCX XML (`word/document.xml`) is fragile and would require understanding OpenXML schema. |
| No change to `parseRows` | The alias-matching and response-type inference logic is format-agnostic; reuse it unchanged so DOCX/PDF rows benefit from the same normalization. |
| Keep `.doc` on the DOCX path | `mammoth` cannot parse legacy `.doc` binary format; the function will throw with a clear message instead of silently returning zero items, which is preferable to a silent 422. |
| Client `accept` filter is advisory only | Browser file pickers respect `accept` for UX, but server-side type detection in `parseQuestionnaire` is the actual enforcement. |

## Verification

### Unit Tests & Edge Cases

**DOCX edge cases:**
- DOCX with a table → items extracted
- DOCX with no table → throws descriptive error
- DOCX table with header row using aliased column names (e.g. "Vendor Answer" for `response`) → alias matching works
- DOCX with multiple tables → uses first table that has a recognized header

**PDF edge cases:**
- PDF with tab-separated columns → heuristic 1 extracts items
- PDF with 2+-space-aligned columns → heuristic 2 extracts items
- PDF with neither → throws descriptive error (not a 500)
- PDF with only 1-2 data lines (too small to be a real questionnaire) → zero items → handled by existing 422 "no rows extracted" check in `upload.ts`

**Regression:**
- Existing XLSX/CSV path unchanged (same `XLSX.read` logic, now in an `async` wrapper)
- All four existing `parseRows` tests pass

### Acceptance Criteria

1. A `.docx` SIG questionnaire with a table structure uploads successfully and produces `questionnaire_items` rows.
2. A `.pdf` SIG questionnaire with tab-separated or whitespace-aligned columns uploads successfully and produces `questionnaire_items` rows.
3. An existing `.xlsx` questionnaire upload is unaffected — same items, same analysis result.
4. An unsupported file type (e.g. `.txt`) still returns 422 with a clear message.
5. A Word or PDF file with no detectable table structure returns 422 with a message directing the user to use `.xlsx` or `.docx`.
6. The upload form `accept` filter lists `.docx` and `.pdf` alongside existing spreadsheet types.
7. `npm run check`, `npm run typecheck`, `npm run test`, and `npm run build` all pass with zero errors.

### UX Scenarios, Acceptance & Evidence Checklist

The change is UX-facing: the questionnaire file input label, `accept` attribute, and validation message in `client/src/pages/NewAssessment.tsx` are updated.

**UX Scenarios:**

| Scenario | Route | Viewports |
|---|---|---|
| New-assessment upload form shows updated questionnaire label | `/assessments/new` | mobile 375, tablet 768, desktop 1280 |
| File picker accepts `.docx` and `.pdf` in addition to spreadsheets | `/assessments/new` | desktop 1280 |
| Validation message when no file selected references all 5 formats | `/assessments/new` | mobile 375, desktop 1280 |

**UX Acceptance Criteria:**
- At all three viewports, the questionnaire label reads `SIG questionnaire (.xlsx, .xls, .csv, .docx, .pdf)` with no horizontal overflow at 375 px.
- `axe-core`: no new serious/critical violations introduced on the New Assessment form.
- Focus ring is visible on the questionnaire file input at all viewports.
- No console errors on the `/assessments/new` page.

**Before/After Screenshots `/ux_validate` must capture:**
1. Before: questionnaire label showing `.xlsx, .xls, .csv` only.
2. After: questionnaire label showing all five formats including `.docx, .pdf`.
3. After (mobile 375 px): confirm no text overflow or wrapping breaks the label layout.

**UX regression task:**
- Add a scenario entry to `e2e/ux/scenarios.ts` for the New Assessment form (role: Analyst or Submitter, viewports: all three, `steps: [{ type: 'goto', path: '/assessments/new' }]`, `invariants` default set).
- Run `npm run test:ux` to confirm the new scenario passes.

### Validation Commands

```bash
# 1. Lint + format
npm run check

# 2. TypeScript type checks (server + client)
npm run typecheck

# 3. Unit tests (server extraction tests + all others)
npm run test

# 4. Client production build
npm run build

# 5. E2E test — read instructions then execute
# Read .claude/commands/test_e2e.md
# Read and execute .claude/commands/e2e/test_word_pdf_questionnaire.md
```

## Known Limitations / Follow-ups

- **Scanned PDFs (image-only):** `pdf-parse` extracts zero text from scanned PDFs. Adding OCR is out of scope; the 422 message should guide users to the digital export. This is consistent with the existing evidence-file behaviour (images stored without OCR).
- **Legacy `.doc` files:** `mammoth` cannot parse binary `.doc` format. The parser will throw, producing a 422 with a message to re-save as `.docx`.
- **Complex PDF layouts:** PDFs with multi-column text flows, footnotes, or non-tabular SIG layouts may defeat the heuristics. The fallback 422 message directs users to `.xlsx`/`.docx`. A future follow-up could integrate `pdfjs-dist` for higher-fidelity table extraction.
- **Large PDF questionnaires:** `pdf-parse` loads the entire file into memory. The existing 25 MB upload cap applies; no additional limit is needed.
- **`.xlsm` extension:** already handled by the XLSX default path; no change needed.
