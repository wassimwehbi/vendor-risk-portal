# E2E Test — Word & PDF Questionnaire Upload

Verify that an Analyst can upload a `.docx` or `.pdf` SIG questionnaire and receive
extracted items, and that uploading an unsupported type returns a 422 with a clear
error message in the UI.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_word_pdf_questionnaire'

## Instructions

- Run every command from the repository (or worktree) root.
- The Playwright config boots its own offline stack — do NOT start the app yourself.
- Return ONLY the JSON array with test results (valid JSON, no markdown wrapping).
- If a test passes, omit the `error` field.
- If a test fails, include the failure message and the step where it failed in `error`.

## Fixtures

The tests need small questionnaire fixtures. Generate them inline in the Playwright
test using the fixture-builder helpers described below — no binary files need to be
checked into the repo.

**DOCX fixture** — Use the `docx` npm package (already available as a dev transitive
dep, or install it ad-hoc) to create a minimal `.docx` buffer with one `Table` row:

| Question ID | Question | Response |
|---|---|---|
| Q1 | Do you use MFA? | Yes |
| Q2 | Is data encrypted at rest? | No |

Alternatively, check whether a sample fixture already exists under `e2e/fixtures/`.

**PDF fixture** — Write a tiny text file with tab-separated content and rename it
`.pdf` for upload (the heuristic parses text content, not PDF binary structure). A
simpler approach: create a valid minimal PDF using the `pdf-lib` package with a single
page containing tab-separated table text.

## Setup

1. If `.ports.env` exists at the repo/worktree root, source it: `source .ports.env`.
2. Run the targeted spec:
   ```
   npx playwright test e2e/word_pdf_questionnaire.spec.ts
   ```
   If the spec file does not yet exist, run the full suite instead:
   ```
   npm run test:e2e
   ```

## Test Steps

### 1. Upload a `.docx` questionnaire — items extracted

1. Sign in as Analyst via dev-login (`e2e-analyst-docx@example.test`, role `Analyst`,
   tenant `E2E DocxPDF Co`).
2. Navigate to `/assessments/new`.
3. Fill in vendor name `ACME Docx Vendor`, select questionnaire type `SIG Core`, leave
   today's date.
4. Attach the DOCX fixture to the **SIG questionnaire** file input.
5. Click **Upload & analyze**.
6. Wait for navigation to `/assessments/:id`.
7. Assert at least one questionnaire item row is visible (e.g. check for `Do you use MFA?`).
8. Assert the assessment status badge is not `pending` (i.e. items were extracted and
   analysis started).
9. Take a screenshot of the review workspace showing the extracted items.

### 2. Upload a `.pdf` questionnaire — items extracted

1. Continuing as the same Analyst (or re-login).
2. Navigate to `/assessments/new`.
3. Fill in vendor name `ACME PDF Vendor`, questionnaire type `SIG Core`.
4. Attach the PDF fixture to the **SIG questionnaire** file input.
5. Click **Upload & analyze**.
6. Wait for navigation to `/assessments/:id`.
7. Assert at least one questionnaire item row is visible.
8. Take a screenshot of the review workspace.

### 3. Questionnaire label lists all five formats

1. Navigate to `/assessments/new`.
2. Assert the label text reads exactly:
   `SIG questionnaire (.xlsx, .xls, .csv, .docx, .pdf)`
3. Assert no horizontal overflow at 375 px viewport width.
4. Take a screenshot of the file input section at 375 px.

### 4. Unsupported file type returns 422 error in the UI

1. Navigate to `/assessments/new`.
2. Fill in vendor name `Bad Format Vendor`, questionnaire type `SIG Core`.
3. Attach a `.txt` plain-text file (no columns) to the questionnaire file input.
4. Click **Upload & analyze**.
5. Assert an error notice is visible on the page (the `ErrorNote` component).
6. Assert the error message contains text about parsing or unsupported format.
7. Take a screenshot of the error state.

### 5. Existing `.xlsx` questionnaire upload is unaffected

1. Navigate to `/assessments/new`.
2. Fill in vendor name `ACME Excel Vendor`.
3. Attach the `sig-core.csv` sample (or a generated `.xlsx` fixture).
4. Click **Upload & analyze**.
5. Assert navigation to `/assessments/:id` succeeds.
6. Assert questionnaire items are visible.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "DOCX questionnaire upload extracts items",
    "status": "passed",
    "execution_command": "npx playwright test e2e/word_pdf_questionnaire.spec.ts"
  },
  {
    "test_name": "PDF questionnaire upload extracts items",
    "status": "passed",
    "execution_command": "npx playwright test e2e/word_pdf_questionnaire.spec.ts"
  },
  {
    "test_name": "Questionnaire label lists all five formats",
    "status": "passed",
    "execution_command": "npx playwright test e2e/word_pdf_questionnaire.spec.ts"
  },
  {
    "test_name": "Unsupported file type returns 422 error in UI",
    "status": "passed",
    "execution_command": "npx playwright test e2e/word_pdf_questionnaire.spec.ts"
  },
  {
    "test_name": "Existing .xlsx questionnaire upload is unaffected",
    "status": "passed",
    "execution_command": "npx playwright test e2e/word_pdf_questionnaire.spec.ts"
  }
]
```
