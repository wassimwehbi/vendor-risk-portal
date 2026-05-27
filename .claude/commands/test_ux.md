# UX Regression Test Runner

Execute the scenario-driven UX regression suite for the Vendor Risk Portal and return the results as a standardized JSON array for automated processing.

## Variables

adw_id: $1 if provided, otherwise generate a random 8 character hex string
agent_name: $2 if provided, otherwise use 'ux_test_runner'

## Instructions

- Run every command from the repository (or worktree) root.
- IMPORTANT: The UX suite (`playwright.ux.config.ts`) boots its OWN offline stack on dedicated ports (server + Vite dev server) with `reuseExistingServer: false`, and signs in once per role via a `setup` project. You do NOT need to start the app yourself.
- IMPORTANT: Return ONLY the JSON array with test results.
  - Do not include any additional text, explanations, or markdown formatting.
  - We run JSON.parse() on the output, so make sure it is valid JSON.
- If a test passes, omit the `error` field.
- If a test fails, mark it `failed` and include the failure message (assertion failure, the offending overflow element, an axe violation id, a console error, etc.) in `error`, naming the scenario + viewport where it failed.
- Capture and report any unexpected errors (e.g. the webServer failing to start).
- Ultra think about the Playwright output and map each scenario/viewport to a result entry.

## Setup

1. If `.ports.env` exists at the repo/worktree root, source it first: `source .ports.env`. (The UX config still self-manages its own dedicated E2E ports.)
2. Run the suite:
   - `npm run test:ux`
   - This runs `playwright test --config=playwright.ux.config.ts`, which starts the offline server + client, mints one session per role, executes all scenarios under `e2e/ux/`, then tears the servers down.

## Report

- Exclusively return the JSON array specified in the `Output Format` below — one entry per UX scenario/viewport test.
- The `execution_command` should reproduce the run (`npm run test:ux`, or a targeted `npx playwright test --config=playwright.ux.config.ts -g "<title>"`).

### Output Format

```json
[
  {
    "test_name": "string - the scenario @ viewport (e.g. 'new-assessment @ mobile')",
    "status": "passed",
    "execution_command": "npm run test:ux",
    "error": null
  },
  {
    "test_name": "string - the scenario @ viewport",
    "status": "failed",
    "execution_command": "npm run test:ux",
    "error": "string - what went wrong (overflow offender / axe rule / console error) and where"
  }
]
```
