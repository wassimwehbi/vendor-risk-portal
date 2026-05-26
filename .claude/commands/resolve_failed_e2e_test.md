# Resolve Failed E2E Test

Fix a specific failing E2E test using the provided failure details.

## Instructions

1. **Analyze the E2E Test Failure**
   - Review the JSON data in the `Test Failure Input`, paying attention to:
     - `test_name`: The name of the failing test or spec
     - `execution_command`: The command used to run it
     - `error`: The specific error that occurred (assertion failure, missing element, timeout, etc.)
   - Understand what the test is trying to validate from a user-interaction perspective

2. **Understand Test Execution**
   - Read `.claude/commands/test_e2e.md` to understand how E2E tests are executed
   - Read the failing spec under `e2e/` (e.g. `e2e/smoke.spec.ts`) to understand the steps, intent, and assertions
   - Note that `playwright.config.ts` boots its own offline stack on dedicated ports — you do not start the app manually

3. **Reproduce the Failure**
   - IMPORTANT: Re-run the failing test. Use `npm run test:e2e` for the full suite, or scope to the single spec with `npx playwright test <path-to-spec>` for a faster loop
   - Observe the browser behavior / Playwright output and confirm you can reproduce the exact failure
   - Compare the error you see with the error reported in the JSON

4. **Fix the Issue**
   - Based on your reproduction, identify the root cause
   - Make minimal, targeted changes to resolve only this E2E test failure
   - Consider common E2E issues:
     - Element selector / accessible-name changes
     - Timing issues (elements not ready, missing `await`/`waitFor`)
     - UI layout or copy changes
     - Application logic modifications
   - Ensure the fix aligns with the user intent of the spec
   - Respect TypeScript strict mode and Biome formatting
   - IMPORTANT: This is a vendor-risk app — never change the human-in-the-loop approval contract to make a test pass

5. **Validate the Fix**
   - Re-run the same E2E test to confirm it now passes
   - IMPORTANT: The test must complete successfully before considering it resolved
   - Do NOT run other tests or the full test suite beyond this spec
   - Focus only on fixing this specific E2E test

## Test Failure Input

$ARGUMENTS

## Report

Provide a concise summary of:
- Root cause identified (e.g., missing element, timing issue, incorrect selector)
- Specific fix applied
- Confirmation that the E2E test now passes after your fix
