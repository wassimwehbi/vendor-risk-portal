# Resolve Failed UX Test

Fix a specific failing UX regression scenario using the provided failure details.

## Instructions

1. **Analyze the UX Test Failure**
   - Review the JSON in the `Test Failure Input`: `test_name` (the `scenario @ viewport`), `execution_command`, and `error`.
   - The `error` names the violated invariant: a horizontal-overflow offender element, an axe rule id, a console error, a missing focus ring, or a visible `.no-print` element.

2. **Understand the Harness**
   - Read `.claude/commands/test_ux.md` and `specs/0012-ux-tasks-harness.md`.
   - Read `e2e/ux/scenarios.ts` (the manifest), `e2e/ux/harness.ts` (the invariant helpers), and `e2e/ux/ux.spec.ts` (the runner).
   - The UX config (`playwright.ux.config.ts`) boots its own offline stack and signs in per role — you do not start the app manually.

3. **Reproduce the Failure**
   - IMPORTANT: Re-run the failing scenario scoped for a fast loop:
     `npx playwright test --config=playwright.ux.config.ts -g "<scenario title>"`.
   - Confirm you see the same invariant violation.

4. **Fix the Root Cause — prefer fixing the app, not the test**
   - The harness asserts real UX invariants. A failure usually means a genuine UX defect:
     - **Overflow**: an element exceeds the viewport — wrap wide content in `overflow-x-auto`, add `min-w-0` to a flex/grid ancestor, or apply `break-words` to long unbreakable strings. Use the offender named in the error.
     - **axe**: fix the a11y violation (missing label/role/alt, bad ARIA). Do NOT add to `KNOWN_AXE_DEBT` unless it is genuinely pre-existing, pervasive debt — that is a deliberate, documented decision, not a quick test fix.
     - **console error / focus ring / print**: fix the underlying app behavior.
   - Only adjust the scenario/manifest if the *expectation* was wrong (e.g. a route changed). Never weaken an invariant just to make it pass.
   - Match the design language (`client/src/index.css` shared utilities; slate/`brand`). Respect TypeScript strict mode + Biome.
   - IMPORTANT: This is a vendor-risk app — never change the human-in-the-loop approval contract to make a test pass.

5. **Validate the Fix**
   - Re-run the same scoped scenario and confirm it passes. Do not run unrelated tests.

## Test Failure Input

$ARGUMENTS

## Report

Provide a concise summary of: the root cause, the specific fix (app vs manifest), and confirmation the scenario now passes.
