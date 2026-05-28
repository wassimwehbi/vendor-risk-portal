# E2E Test — Business Context Field

Verify that the "Business context" textarea is visible and saveable in the ReviewWorkspace,
and that the saved value appears in the report page.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_business_context'

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
   npx playwright test e2e/business_context.spec.ts
   ```
   If the spec file does not yet exist, run the full UX suite instead:
   ```
   npm run test:ux
   ```

## Test Steps

### 1. "Business context" textarea is visible and distinct from "Analyst notes"

1. Sign in as Analyst via dev-login (`e2e-analyst-bc@example.test`, role `Analyst`,
   tenant `E2E BC Co`).
2. Navigate to `/showcase` and click **Load & Analyze** on the first scenario; wait
   for the assessment page URL (`/assessments/:id`).
3. Assert `#business-context` textarea is visible.
4. Assert `#analyst-notes` textarea is also visible.
5. Assert the two textareas have different `id` attributes (they are not the same element).
6. Take a screenshot of the analyst decision section showing both textareas.

### 2. Business context can be saved independently

1. Continuing from step 1 (same page, same assessment).
2. Type `"Regulatory compliance driver — GDPR Art. 28 assessment"` into `#business-context`.
3. Click **Save business context**.
4. Assert the button re-enables (is no longer in loading state) and no error banner is shown.
5. Reload the page and assert `#business-context` contains the saved text.

### 3. Business context appears in the report page

1. Navigate to `/assessments/:id/report` for the same assessment.
2. Assert a heading with text **"Business context"** is visible in the report body.
3. Assert the text `"Regulatory compliance driver"` appears in the report.
4. Assert the "Business context" section appears above the "Analyst notes" section.
5. Take a screenshot of the report page showing the Business context section.

### 4. No horizontal overflow at mobile (375 px) with both textareas visible

1. Set viewport to 375 × 812.
2. Navigate to `/assessments/:id`.
3. Assert `#business-context` is visible.
4. Assert no horizontal scroll (page `scrollWidth ≤ innerWidth + 2`).
5. Take a screenshot of the mobile view showing the analyst decision section.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "Business context textarea is visible and distinct from Analyst notes",
    "status": "passed",
    "execution_command": "npx playwright test e2e/business_context.spec.ts"
  },
  {
    "test_name": "Business context can be saved independently",
    "status": "passed",
    "execution_command": "npx playwright test e2e/business_context.spec.ts"
  },
  {
    "test_name": "Business context appears in the report page",
    "status": "passed",
    "execution_command": "npx playwright test e2e/business_context.spec.ts"
  },
  {
    "test_name": "No horizontal overflow at mobile 375 px with both textareas",
    "status": "passed",
    "execution_command": "npx playwright test e2e/business_context.spec.ts"
  }
]
```
