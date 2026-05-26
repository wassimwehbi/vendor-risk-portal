# Application Validation Test Suite

Execute comprehensive validation tests for the Vendor Risk Portal (Express + SQLite server, React + Vite + Tailwind client), returning results in a standardized JSON format for automated processing.

## Purpose

Proactively identify and fix issues in the application before they impact users or developers. By running this comprehensive test suite, you can:
- Detect lint/format violations, type mismatches, and import failures
- Identify broken unit tests
- Verify the production build and dependencies
- Ensure the application is in a healthy state

## Variables

TEST_COMMAND_TIMEOUT: 5 minutes

## Instructions

- Run every command from the repository (or worktree) root.
- Execute each test in the sequence provided below, IN ORDER.
- Capture the result (passed/failed) and any error messages.
- IMPORTANT: Return ONLY the JSON array with test results.
  - IMPORTANT: Do not include any additional text, explanations, or markdown formatting.
  - We'll immediately run JSON.parse() on the output, so make sure it's valid JSON.
- If a test passes, omit the `error` field.
- If a test fails, include the error message in the `error` field.
- Error Handling:
  - If a command returns a non-zero exit code, mark it as failed and immediately STOP processing tests.
  - Capture stderr output for the `error` field.
  - Timeout commands after `TEST_COMMAND_TIMEOUT`.
  - IMPORTANT: If a test fails, stop processing tests and return ONLY the results gathered so far (the failed test plus any that already passed). Do not run the remaining tests.
- Test execution order is important - cheaper/foundational checks run first so failures surface fast.
- Always run `pwd` before the sequence to ensure you're operating from the repo/worktree root.

## Test Execution Sequence

1. **Lint & Format Check**
   - Command: `npm run check`
   - test_name: "lint_format"
   - test_purpose: "Runs Biome CI lint + format checks across the repo to catch style violations, formatting drift, and lint errors before anything else."

2. **TypeScript Type Check**
   - Command: `npm run typecheck`
   - test_name: "typecheck"
   - test_purpose: "Runs the server and client TypeScript type checks (strict mode) to catch type errors, missing imports, and incorrect signatures without emitting output."

3. **Unit Tests**
   - Command: `npm run test`
   - test_name: "unit_tests"
   - test_purpose: "Runs the server and client unit test suites to validate application behavior including extraction, framework mapping, risk scoring, and API endpoints."

4. **Production Build**
   - Command: `npm run build`
   - test_name: "build"
   - test_purpose: "Runs the client production build (bundling, asset optimization, production compilation) to validate the app compiles for release."

## Report

- IMPORTANT: Return results exclusively as a JSON array based on the `Output Structure` section below.
- Sort the JSON array with the failed test (passed: false) at the top, if any.
- Include every test that was actually run (both passed and failed). Tests skipped because of an earlier failure must NOT be included.
- The `execution_command` field should contain the exact command that can be run to reproduce the test.
- This allows subsequent agents to quickly identify and resolve errors.

### Output Structure

```json
[
  {
    "test_name": "string",
    "passed": true,
    "execution_command": "string",
    "error": "optional string (omit when passed)"
  }
]
```

### Example Output

```json
[
  {
    "test_name": "typecheck",
    "passed": false,
    "execution_command": "npm run typecheck",
    "error": "TS2345: Argument of type 'string' is not assignable to parameter of type 'number'"
  },
  {
    "test_name": "lint_format",
    "passed": true,
    "execution_command": "npm run check"
  }
]
```
