# E2E Test — Risk Scoring Factors (Internet-Facing + Personal Data Volume)

Verify that the `internet_facing` and `personal_data_volume` scoring signals are
captured in the UI, persisted, and reflected in the overall risk after AI analysis.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_risk_scoring_factors'

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
   npx playwright test e2e/risk_scoring_factors.spec.ts
   ```
   If the spec file does not yet exist, run the full suite instead:
   ```
   npm run test:e2e
   ```

## Test Steps

### 1. CloudPay demo scenario — summary grid shows internet-facing and volume

1. Sign in as Analyst via dev-login (`e2e-analyst-rsf@example.test`, role `Analyst`,
   tenant `E2E RSF Co`).
2. Load the CloudPay demo scenario via `POST /api/demo/scenarios/cloudpay/load`.
3. Navigate to `/assessments/:id`.
4. Assert the "Internet-facing" summary cell shows `Yes` (chip text).
5. Assert the "Personal data volume" summary cell shows `High` (chip text).
6. Take a screenshot of the summary grid.

### 2. Run AI analysis — overall risk is Critical for CloudPay

1. Click `Run AI analysis` on the CloudPay assessment.
2. Wait for the button to return to its idle state.
3. Assert the "Preliminary overall risk" badge shows `Critical`.
4. Take a screenshot of the summary grid after analysis.

### 3. Toggle internet-facing off — cell updates to No

1. In the "Internet-facing" summary cell, click `Mark No`.
2. Assert the chip now shows `No` (optimistic UI update — no reload required).
3. Assert the hint text "Takes effect on next analysis run" is visible.
4. Take a screenshot of the updated cell.

### 4. New assessment form — exposure context section is visible

1. Navigate to `/assessments/new`.
2. Assert a fieldset (or section) labelled "Exposure context" is visible.
3. Assert a checkbox with label text containing "Internet-facing system" is present.
4. Assert a select with id `na-data-volume` is present, with option text `— unknown —`.
5. At 375 px viewport width, assert no horizontal overflow and that the checkbox
   and select labels are legible.
6. Take a screenshot of the form at 375 px.

### 5. Create assessment with exposure context — values persist

1. Navigate to `/assessments/new`.
2. Fill in vendor name `RSF Test Vendor`, select questionnaire type `SIG Core`.
3. Check the "Internet-facing system" checkbox.
4. Select `High (> 1 M records)` in the volume select.
5. Attach any valid SIG questionnaire fixture.
6. Click `Upload & analyze`.
7. Wait for navigation to `/assessments/:id`.
8. Assert the "Internet-facing" cell shows `Yes`.
9. Assert the "Personal data volume" cell shows `High`.
10. Take a screenshot of the summary grid.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "CloudPay demo: summary grid shows Internet-facing Yes and High volume",
    "status": "passed",
    "execution_command": "npx playwright test e2e/risk_scoring_factors.spec.ts"
  },
  {
    "test_name": "CloudPay AI analysis: overall risk is Critical",
    "status": "passed",
    "execution_command": "npx playwright test e2e/risk_scoring_factors.spec.ts"
  },
  {
    "test_name": "Toggle internet-facing off: cell updates to No",
    "status": "passed",
    "execution_command": "npx playwright test e2e/risk_scoring_factors.spec.ts"
  },
  {
    "test_name": "New assessment form: Exposure context section visible at 375px",
    "status": "passed",
    "execution_command": "npx playwright test e2e/risk_scoring_factors.spec.ts"
  },
  {
    "test_name": "Create assessment with exposure context: values persist in summary grid",
    "status": "passed",
    "execution_command": "npx playwright test e2e/risk_scoring_factors.spec.ts"
  }
]
```
