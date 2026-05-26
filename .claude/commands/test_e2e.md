# E2E Test Runner

Execute the end-to-end (E2E) test suite for the Vendor Risk Portal using Playwright, and return the results in a standardized JSON format for automated processing.

## Variables

adw_id: $1 if provided, otherwise generate a random 8 character hex string
agent_name: $2 if provided, otherwise use 'test_e2e'

## Instructions

- Run every command from the repository (or worktree) root.
- IMPORTANT: The Playwright config (`playwright.config.ts`) boots its OWN offline stack on dedicated ports (server + Vite dev server) with `reuseExistingServer: false`. You do NOT need to start the app yourself — Playwright manages the servers for the duration of the run.
- IMPORTANT: Return ONLY the JSON array with test results.
  - IMPORTANT: Do not include any additional text, explanations, or markdown formatting.
  - We'll immediately run JSON.parse() on the output, so make sure it's valid JSON.
- If a test passes, omit the `error` field.
- If a test fails, mark it as failed and include the failure message (assertion failure, missing element, timeout, etc.) in the `error` field, naming the step where it failed if known.
- Capture and report any unexpected errors (e.g. the webServer failing to start).
- Ultra think about the Playwright output and map each spec/test to a result entry.

## Setup

1. If `.ports.env` exists at the repo/worktree root, source it first: `source .ports.env`. This makes the worktree port assignments available to the run. (The Playwright config still self-manages its own dedicated E2E ports.)
2. Run the suite:
   - `npm run test:e2e`
   - This runs `playwright test`, which starts the offline server + client, executes all specs under `e2e/`, then tears the servers down.

## Report

- Exclusively return the JSON array as specified in the `Output Format` below — one entry per E2E test.
- The `execution_command` field should contain the exact command that reproduces the run (`npm run test:e2e`, or the targeted `npx playwright test <file>` if you scoped a single spec).

### Output Format

```json
[
  {
    "test_name": "string - the Playwright test or spec name",
    "status": "passed",
    "execution_command": "npm run test:e2e",
    "error": null
  },
  {
    "test_name": "string - the Playwright test or spec name",
    "status": "failed",
    "execution_command": "npm run test:e2e",
    "error": "string - what went wrong and the step where it failed"
  }
]
```
