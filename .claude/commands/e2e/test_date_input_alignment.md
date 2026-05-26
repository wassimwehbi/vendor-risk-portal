# E2E Test — Date Input Alignment on New Assessment Form

Verify that the `Date submitted` input on the New Assessment page is left-aligned and
consistent with sibling inputs, and does not overflow the form card on a 375 px viewport.

## Variables

adw_id: $1 if provided, otherwise generate a random 8-character hex string
agent_name: $2 if provided, otherwise use 'test_date_input_alignment'

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
   npx playwright test e2e/date_input_alignment.spec.ts
   ```
   If the spec file does not yet exist, run the full suite instead:
   ```
   npm run test:e2e
   ```

## Test Steps

The test navigates to the New Assessment page on a 375 px wide viewport and asserts:

1. Sign in via the developer sign-in form (email `e2e-analyst@example.test`, role
   `Analyst`, tenant `E2E Co`).
2. Navigate to `/assessments/new`.
3. Locate the **Date submitted** `<input type="date">` element.
4. Assert its computed `text-align` is `left` (not `center`).
5. Locate the **Vendor name** `<input type="text">` element and assert the same.
6. Assert both inputs are visually within the bounds of the form card (no overflow).
7. Take a screenshot scoped to the form card at 375 px viewport width for visual
   confirmation.

## Report

Return the JSON array as specified in `.claude/commands/test_e2e.md` — one entry per
test step that maps to a Playwright assertion.

```json
[
  {
    "test_name": "Date submitted input is left-aligned on 375 px viewport",
    "status": "passed",
    "execution_command": "npx playwright test e2e/date_input_alignment.spec.ts"
  }
]
```
