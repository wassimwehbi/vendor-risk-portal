# E2E Test — GRC JSON Export

Verify that an Analyst can see the "Export GRC JSON" button in the ReportView toolbar
and that clicking it initiates a file download pointing to the correct `.json` URL.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_grc_export'

## Instructions

- Run every command from the repository (or worktree) root.
- The Playwright config boots its own offline stack — do NOT start the app yourself.
- Return ONLY the JSON array with test results (valid JSON, no markdown wrapping).
- If a test passes, omit the `error` field.
- If a test fails, include the failure message and the step where it failed in `error`.

## Setup

1. If `.ports.env` exists at the repo/worktree root, source it: `source .ports.env`.
2. Run the targeted spec:
   ```
   npx playwright test e2e/grc_export.spec.ts
   ```
   If the spec file does not yet exist, run the full suite instead:
   ```
   npm run test:e2e
   ```

## Test Steps

### 1. "Export GRC JSON" button is visible in the ReportView toolbar

1. Sign in as Analyst via dev-login (`e2e-analyst-grc@example.test`, role `Analyst`,
   tenant `E2E GRC Co`).
2. Navigate to `/showcase` and click **Load & Analyze** on the first scenario; wait
   for the assessment page URL (`/assessments/:id`).
3. Navigate to `/assessments/:id/report`.
4. Assert the button labelled **Export GRC JSON** is visible in the toolbar.
5. Take a screenshot of the toolbar showing all export buttons (CSV, Excel, GRC JSON,
   Print / PDF).

### 2. "Export GRC JSON" button href points to the correct JSON endpoint

1. Continuing from step 1 (same page, same assessment).
2. Locate the `<a>` element with text **Export GRC JSON**.
3. Assert its `href` attribute ends with `/export.json` (e.g.
   `/api/assessments/:id/export.json`).

### 3. All four export buttons are present and no horizontal overflow at mobile (375 px)

1. Set viewport to 375 × 812.
2. Navigate to `/assessments/:id/report`.
3. Assert all four buttons visible: **Export CSV**, **Export Excel**,
   **Export GRC JSON**, **Print / PDF**.
4. Assert no horizontal scroll (page `scrollWidth ≤ innerWidth + 2`).
5. Take a screenshot of the mobile toolbar.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "Export GRC JSON button is visible in the ReportView toolbar",
    "status": "passed",
    "execution_command": "npx playwright test e2e/grc_export.spec.ts"
  },
  {
    "test_name": "Export GRC JSON button href points to /export.json",
    "status": "passed",
    "execution_command": "npx playwright test e2e/grc_export.spec.ts"
  },
  {
    "test_name": "All four export buttons present with no overflow at mobile 375 px",
    "status": "passed",
    "execution_command": "npx playwright test e2e/grc_export.spec.ts"
  }
]
```
