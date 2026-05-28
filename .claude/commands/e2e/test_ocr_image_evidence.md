# E2E Test — OCR / Image Evidence Vision Description

Verify that an Analyst can upload a PNG screenshot as evidence and have it described by
the Claude Vision API, and that the `EvidencePanel` displays the AI-attribution chip and
correct button labels. Also verifies offline fallback and unsupported format handling.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_ocr_image_evidence'

## Instructions

- Run every command from the repository (or worktree) root.
- The Playwright config boots its own offline stack — do NOT start the app yourself.
- Return ONLY the JSON array with test results (valid JSON, no markdown wrapping).
- If a test passes, omit the `error` field.
- If a test fails, include the failure message and the step where it failed in `error`.

## Fixtures

**PNG fixture** — A minimal 1×1 PNG (base64 below) is sufficient for upload tests.
The vision path is exercised only when `ANTHROPIC_API_KEY` is set in the test environment.

```
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
```

**BMP fixture** — Create a Buffer with a BMP magic header (`0x42 0x4D`) to simulate an
unsupported image type.

**SVG fixture** — A minimal inline SVG string:
```
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>
```

## Setup

1. If `.ports.env` exists at the repo/worktree root, source it: `source .ports.env`.
2. Run the targeted spec:
   ```
   npx playwright test e2e/ocr_image_evidence.spec.ts
   ```
   If the spec file does not yet exist, run the full suite instead:
   ```
   npm run test:e2e
   ```

## Test Steps

### 1. Upload a PNG screenshot — AI description shown (with API key)

1. Sign in as Analyst (`e2e-analyst-ocr@example.test`, role `Analyst`, tenant `E2E OCR Co`).
2. Navigate to `/assessments/new`.
3. Fill in vendor name `ACME Vision Vendor`, select questionnaire type `SIG Core`.
4. Attach a valid CSV questionnaire to the SIG questionnaire input (e.g. a two-row CSV).
5. Attach the PNG fixture to the **evidence** file input.
6. Click **Upload & analyze**.
7. Wait for navigation to `/assessments/:id`.
8. Assert the evidence panel is visible with the text "Evidence files".
9. When `ANTHROPIC_API_KEY` is set: assert a green "Text extracted" badge and an "AI described"
   provenance chip are visible for the image evidence item.
10. When `ANTHROPIC_API_KEY` is set: assert a "Show AI description" button is visible.
11. Take a screenshot of the evidence panel.

### 2. AI description text is included in analysis context

1. Using the assessment created in test 1 (or a new one with a PNG evidence file).
2. Wait for analysis to complete (status not `pending`).
3. Assert `evidence_sufficiency` in the findings is not "None" for at least one item
   (indicating the AI description was fed into the analysis pipeline).

### 3. Without ANTHROPIC_API_KEY — image shows gray "No text" badge (offline fallback)

1. Ensure `ANTHROPIC_API_KEY` is unset in the test environment.
2. Sign in as Analyst and navigate to `/assessments/new`.
3. Upload a PNG evidence file alongside a valid questionnaire.
4. After navigation to `/assessments/:id`, assert the evidence panel shows a gray
   "No text" badge for the image item (no "AI described" chip).
5. Assert no "Show AI description" button is visible.
6. Take a screenshot of the evidence panel showing the fallback state.

### 4. BMP image upload — unsupported MIME falls back to "No text" gracefully

1. Navigate to `/assessments/new` as Analyst.
2. Fill in vendor name `ACME BMP Vendor`, select questionnaire type `SIG Core`.
3. Attach a valid CSV questionnaire.
4. Attach a `.bmp` file (the BMP fixture) to the evidence input.
5. Click **Upload & analyze**.
6. After navigation, assert the evidence panel shows "No text" for the BMP item.
7. Assert no error banner is visible (upload succeeded, graceful fallback).

### 5. SVG file upload — "Text extracted" shown (SVG markup read directly)

1. Navigate to `/assessments/new` as Analyst.
2. Fill in vendor name `ACME SVG Vendor`, select questionnaire type `SIG Core`.
3. Attach a valid CSV questionnaire.
4. Attach a `.svg` file (the SVG fixture) to the evidence input.
5. Click **Upload & analyze**.
6. After navigation, assert the evidence panel shows "Text extracted" for the SVG item.
7. Assert the character count shown is greater than 0.
8. Click "Show extracted text" (or "Show AI description") and assert the text area
   contains `<svg`.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "PNG screenshot upload shows AI description chip when API key set",
    "status": "passed",
    "execution_command": "npx playwright test e2e/ocr_image_evidence.spec.ts"
  },
  {
    "test_name": "AI description text is included in analysis context",
    "status": "passed",
    "execution_command": "npx playwright test e2e/ocr_image_evidence.spec.ts"
  },
  {
    "test_name": "Without API key, image shows No text badge (offline fallback)",
    "status": "passed",
    "execution_command": "npx playwright test e2e/ocr_image_evidence.spec.ts"
  },
  {
    "test_name": "BMP image upload falls back gracefully to No text",
    "status": "passed",
    "execution_command": "npx playwright test e2e/ocr_image_evidence.spec.ts"
  },
  {
    "test_name": "SVG file upload yields Text extracted with SVG markup",
    "status": "passed",
    "execution_command": "npx playwright test e2e/ocr_image_evidence.spec.ts"
  }
]
```
