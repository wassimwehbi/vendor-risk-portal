# Bug Planning

Create a new plan to resolve the `Bug` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Variables
issue_number: $1
adw_id: $2
issue_json: $3

## Instructions

- IMPORTANT: You're writing a plan to resolve a bug based on the `Bug` that will add value to the application.
- IMPORTANT: The `Bug` describes the bug that will be resolved but remember we're not resolving the bug, we're creating the plan that will be used to resolve the bug based on the `Plan Format` below.
- You're writing a plan to resolve a bug, it should be thorough and precise so we fix the root cause and prevent regressions.
- Create the plan in the `specs/adw/` directory with filename: `issue-{issue_number}-adw-{adw_id}-{descriptive-slug}-plan.md`
  - Replace `{descriptive-slug}` with a short, descriptive slug based on the bug (e.g., "fix-login-error", "resolve-upload-timeout", "patch-risk-score-regression")
  - IMPORTANT: The plan lives under `specs/adw/` and ends with the `-plan.md` suffix. This is intentionally separate from the hand-authored `specs/NNNN-*.md` design docs — do NOT collide with those.
  - Create the `specs/adw/` directory if it does not exist.
- Use the plan format below to create the plan.
- Research the codebase to understand the bug, reproduce it, and put together a plan to fix it.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to fix the bug.
- Use your reasoning model: THINK HARD about the bug, its root cause, and the steps to fix it properly.
- IMPORTANT: Be surgical with your bug fix, solve the bug at hand and don't fall off track.
- IMPORTANT: We want the minimal number of changes that will fix and address the bug.
- IMPORTANT: This is a vendor-risk app. The final vendor-risk decision is always made by a human analyst, never automatically by the AI. Do not change that contract while fixing the bug.
- Keep it simple. Respect TypeScript strict mode and Biome formatting (the repo uses `npm run check`).
- If you need a new dependency, install it in the right workspace (`npm --prefix server install <pkg>` or `npm --prefix client install <pkg>`) and be sure to report it in the `Notes` section of the `Plan Format`.
- IMPORTANT: If the bug affects the UI or user interactions:
  - Add a task in the `Step by Step Tasks` section to create a separate E2E test file in `.claude/commands/e2e/test_<descriptive_name>.md` based on examples in that directory
  - Add E2E test validation to your Validation Commands section
  - IMPORTANT: When you fill out the `Plan Format: Relevant Files` section, add an instruction to read `.claude/commands/test_e2e.md`, and `.claude/commands/e2e/test_basic_assessment.md` to understand how to create an E2E test file. List your new E2E test file to the `Plan Format: New Files` section.
  - To be clear, we're not creating a new E2E test file, we're creating a task to create a new E2E test file in the `Plan Format` below
- IMPORTANT: If the fix is UX-facing (touches `client/src/**`, styling, layout, responsive behavior, or accessibility — e.g. the mobile-overflow class of bug), the plan MUST include a `UX Scenarios, Acceptance & Evidence Checklist` section: the UX scenarios + viewports to cover, measurable UX acceptance criteria, and the before/after screenshots that prove the fix. The ADW UX validation phase (`/ux_validate`) audits the rendered result and the deterministic `ux` check (`npm run test:ux`, manifest `e2e/ux/scenarios.ts`) gates merge — see `specs/0012-ux-tasks-harness.md`. Add a task to extend `e2e/ux/scenarios.ts` if a route/flow is added.
- Respect requested files in the `Relevant Files` section.
- Start your research by reading the `README.md` file.

## Relevant Files

Focus on the following files:
- `README.md` - Contains the project overview and instructions.
- `CLAUDE.md` - Contains repository working conventions (specs, build & verify, design language).
- `server/src/**` - Contains the Express + SQLite backend.
- `client/src/**` - Contains the React + Vite + Tailwind SPA.
- `specs/**` - Contains the numbered design docs and history. Read the relevant spec before changing an area.
- `API_CONTRACT.md` - Contains the server/client API contract.
- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.

Ignore all other files in the codebase.

## Plan Format

```md
# Spec — <bug title>

- **Status:** Draft
- **Branch:** <branch name for this ADW run>
- **Location:** <comma-separated list of files to be touched / created>
- **Related docs:** <relevant specs/NNNN-*.md, README.md sections, API_CONTRACT.md>

## Problem / Objective
<describe the bug in detail, including symptoms and expected vs actual behavior. Include a clear Problem Statement, exact Steps to Reproduce, and a Root Cause Analysis.>

## Approach & Changes
<describe the proposed solution approach to fix the bug. List the relevant files and why they matter in bullet points. If new files are required, list them in an h3 'New Files' section.>

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. Order matters: start with the foundational shared changes required to fix the bug then move on to the specific changes. Include tests that will validate the bug is fixed with zero regressions.>

<If the bug affects UI, include a task to create an E2E test file. Your task should look like: "Read `.claude/commands/e2e/test_basic_assessment.md` and create a new E2E test file in `.claude/commands/e2e/test_<descriptive_name>.md` that validates the bug is fixed; be specific with the steps to prove the bug is fixed. We want the minimal set of steps and screenshots to prove it if possible.">

<Your last step should be running the Verification commands to validate the bug is fixed with zero regressions.>

## Key Decisions & Rationale
<explain why this fix addresses the root cause and not just the symptom. Note any tradeoffs.>

## Verification
Execute every command to validate the bug is fixed with zero regressions.

<describe how you reproduce the bug before the fix and confirm it's gone after. If you created an E2E test, include the following validation step: "Read .claude/commands/test_e2e.md`, then read and execute your new E2E `.claude/commands/e2e/test_<descriptive_name>.md` test file to validate this functionality works.">

- `npm run check` - Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` - Server + client TypeScript type checks
- `npm run test` - Server + client unit tests
- `npm run build` - Client production build

## Known Limitations / Follow-ups
<optionally list any additional notes or context relevant to the bug that will help the developer.>
```

## Bug
Extract the bug details from the `issue_json` variable (parse the JSON and use the title and body fields).

## Report

- IMPORTANT: Return exclusively the path to the plan file created and nothing else.
