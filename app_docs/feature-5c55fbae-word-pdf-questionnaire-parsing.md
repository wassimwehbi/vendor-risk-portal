# Word & PDF Questionnaire Parsing

**ADW ID:** 5c55fbae
**Date:** 2026-05-28
**Plan-Spec:** specs/adw/issue-44-adw-5c55fbae-parse-word-pdf-questionnaires-plan.md

## Overview

Extends the questionnaire upload pipeline to accept `.docx` and `.pdf` files in addition to the existing `.xlsx`, `.xls`, and `.csv` formats. Previously, analysts had to convert Word or PDF questionnaires to Excel before uploading; now they can submit the original file directly, saving time and reducing the risk of data loss during format conversion.

## What Was Built

- **DOCX parser** — converts Word tables to structured questionnaire items via `mammoth` HTML output
- **PDF parser** — extracts tabular data from PDF text using two heuristics (tab-separated and whitespace-aligned columns)
- **Async `parseQuestionnaire` dispatcher** — routes by file extension to the correct parser; XLSX/CSV path is unchanged
- **Updated upload form** — `accept` attribute, label text, and validation message in `NewAssessment.tsx` all include `.docx` and `.pdf`
- **Updated API contract** — `API_CONTRACT.md` documents the expanded questionnaire MIME types
- **Extended unit tests** — 15 new tests covering DOCX HTML parsing, PDF text heuristics, dispatcher routing, and error paths
- **E2E test plan** — `.claude/commands/e2e/test_word_pdf_questionnaire.md` for end-to-end upload validation

## Technical Implementation

### Files Modified

- `server/src/services/extraction.ts`: Made `parseQuestionnaire` async; added `parseDocxHtml`, `parsePdfText`, `parseDocxQuestionnaire`, `parsePdfQuestionnaire`, and `parseCellsFromHtml` helpers; swapped `readFileSync` → `readFile` (async)
- `server/src/routes/upload.ts`: Added `await` to the `parseQuestionnaire` call (single line change)
- `client/src/pages/NewAssessment.tsx`: Updated file input `accept` attribute, label text, and missing-file validation message to include `.docx` and `.pdf`
- `server/test/extraction.test.ts`: Added 15 tests for the new parsers and dispatcher
- `API_CONTRACT.md`: Updated `POST /assessments/:id/upload` to list `docx`/`pdf` alongside `xlsx`/`xls`/`csv`
- `e2e/ux/scenarios.ts`: Added New Assessment form UX scenario for viewport regression testing

### Key Changes

- `parseQuestionnaire` signature changed from sync to `async` — the single call site in `upload.ts` was already inside an `async` handler, so the change required only one `await`
- DOCX parsing uses `mammoth.convertToHtml` to reliably extract `<table>` structure, then regex-matches `<tr>`/`<td>`/`<th>` blocks — more robust than parsing raw DOCX XML
- PDF parsing applies two heuristics in priority order: (1) tab-separated lines, (2) whitespace-aligned columns (2+ consecutive spaces); if both yield zero items, a 422-friendly error directs the user to prefer `.xlsx` or `.docx`
- `parseDocxHtml` and `parsePdfText` are exported as pure functions for unit testing without needing real file fixtures or mocking the third-party libraries
- The existing `parseRows` alias-matching logic is reused unchanged for all three format paths

## How to Use

1. Navigate to **New Assessment** (`/assessments/new`).
2. Fill in the vendor name, questionnaire type, and submission date.
3. Click **Choose file** next to "SIG questionnaire" — the file picker now accepts `.xlsx`, `.xls`, `.csv`, `.docx`, and `.pdf`.
4. Select your Word or PDF questionnaire file and upload evidence files as usual.
5. Submit the form. The server detects the format by file extension and routes to the appropriate parser.
6. If the file has no detectable table structure (e.g., a scanned PDF), a 422 error is returned with a message directing the user to re-export as `.xlsx` or `.docx`.

## Configuration

No new environment variables or configuration is required. Both `mammoth` and `pdf-parse` were already listed in `server/package.json`; no new dependencies were added.

The existing 25 MB upload cap applies to all questionnaire formats.

## Testing

```bash
# Type checks
npm run typecheck

# Unit tests (includes new extraction tests)
npm run test

# Client production build
npm run build

# E2E test plan
# Read and execute .claude/commands/e2e/test_word_pdf_questionnaire.md
```

## Notes

- **Scanned PDFs** (image-only): `pdf-parse` extracts zero text; the 422 error guides users to a digital export. This matches existing behaviour for evidence images (stored without OCR).
- **Legacy `.doc` files**: `mammoth` cannot parse the old binary `.doc` format. The parser throws with a clear message prompting the user to re-save as `.docx`.
- **Complex PDF layouts**: PDFs with multi-column flows, footnotes, or non-tabular content may defeat the heuristics. The fallback 422 message directs users to `.xlsx`/`.docx`. Higher-fidelity table extraction (e.g., `pdfjs-dist`) is a possible future follow-up.
- **AI output is preliminary**: extracted questionnaire items feed into the existing AI analysis pipeline; the final vendor-risk decision is always made by a human analyst.
