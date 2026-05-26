# Resolve Failed Test

Fix a specific failing test using the provided failure details.

## Instructions

1. **Analyze the Test Failure**
   - Review the test name, purpose, and error message from the `Test Failure Input`
   - Understand what the test is trying to validate
   - Identify the root cause from the error details

2. **Context Discovery**
   - Check recent changes: `git diff origin/main --stat --name-only`
   - If a relevant plan-spec exists in `specs/adw/*-plan.md` (or a design doc in `specs/NNNN-*.md`), read it to understand requirements
   - Focus only on files that could impact this specific test

3. **Reproduce the Failure**
   - IMPORTANT: Use the `execution_command` provided in the test data (e.g. `npm run check`, `npm run typecheck`, `npm run test`, `npm run build`)
   - Run it from the repo/worktree root to see the full error output and stack trace
   - Confirm you can reproduce the exact failure

4. **Fix the Issue**
   - Make minimal, targeted changes to resolve only this test failure
   - Ensure the fix aligns with the test purpose and any spec requirements
   - Respect TypeScript strict mode and Biome formatting; do not modify unrelated code or tests
   - IMPORTANT: This is a vendor-risk app — never change the human-in-the-loop approval contract to make a test pass

5. **Validate the Fix**
   - Re-run the same `execution_command` to confirm the test now passes
   - Do NOT run other tests or the full test suite
   - Focus only on fixing this specific test

## Test Failure Input

$ARGUMENTS

## Report

Provide a concise summary of:
- Root cause identified
- Specific fix applied
- Confirmation that the test now passes
