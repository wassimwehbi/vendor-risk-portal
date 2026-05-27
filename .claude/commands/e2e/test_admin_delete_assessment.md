# E2E Test — Admin Delete Assessment

Verify that a global Admin can delete an assessment from the Dashboard row and from
the assessment page header, and that non-admin users (Analyst) never see the Delete
action.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_admin_delete_assessment'

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
   npx playwright test e2e/admin_delete_assessment.spec.ts
   ```
   If the spec file does not yet exist, run the full suite instead:
   ```
   npm run test:e2e
   ```

## Test Steps

### 1. Admin sees Delete button; Analyst does not

1. Sign in as Admin via dev-login (`e2e-admin-del@example.test`, role `Admin`).
2. Navigate to `/showcase` and click **Load & Analyze** on the first scenario; wait
   for the assessment page URL (`/assessments/:id`).
3. Navigate to the Dashboard `/`.
4. Assert a `Delete` button is visible in the first assessment row's Actions cell.
5. Sign out.
6. Sign in as Analyst (`e2e-analyst@example.test`, role `Analyst`, tenant `E2E Co`).
7. Assert NO `Delete` button appears on any Dashboard row.
8. Sign out.

### 2. Admin deletes from dashboard row

1. Sign in as Admin (`e2e-admin-del2@example.test`, role `Admin`).
2. Load a demo scenario via `/showcase`; wait for assessment page.
3. Navigate to the Dashboard `/`.
4. Record the vendor name of the first row.
5. Click **Delete** on the first row; **dismiss** the `window.confirm` — assert the
   row is still present.
6. Click **Delete** on the first row again; **accept** the `window.confirm` — assert
   the row is gone from the table.
7. Take a screenshot of the Dashboard for visual confirmation.

### 3. Admin deletes from assessment page header

1. Sign in as Admin (`e2e-admin-del3@example.test`, role `Admin`).
2. Load a demo scenario via `/showcase`; wait for the assessment page (`/assessments/:id`).
3. Assert a `Delete` button is visible in the page header.
4. Click **Delete**; **accept** the `window.confirm`.
5. Assert navigation to `/` (Dashboard).
6. Take a screenshot of the Dashboard after deletion.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "Admin sees Delete button on dashboard rows; analyst does not",
    "status": "passed",
    "execution_command": "npx playwright test e2e/admin_delete_assessment.spec.ts"
  },
  {
    "test_name": "Admin can delete an assessment from the dashboard row",
    "status": "passed",
    "execution_command": "npx playwright test e2e/admin_delete_assessment.spec.ts"
  },
  {
    "test_name": "Admin can delete an assessment from the assessment page header",
    "status": "passed",
    "execution_command": "npx playwright test e2e/admin_delete_assessment.spec.ts"
  }
]
```
