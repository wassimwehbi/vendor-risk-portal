# Feature Planning

Create a new plan to implement the `Feature` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Variables
issue_number: $1
adw_id: $2
issue_json: $3

## Instructions

- IMPORTANT: You're writing a plan to implement a net new feature based on the `Feature` that will add value to the application.
- IMPORTANT: The `Feature` describes the feature that will be implemented but remember we're not implementing a new feature, we're creating the plan that will be used to implement the feature based on the `Plan Format` below.
- Create the plan in the `specs/adw/` directory with filename: `issue-{issue_number}-adw-{adw_id}-{descriptive-slug}-plan.md`
  - Replace `{descriptive-slug}` with a short, descriptive slug based on the feature (e.g., "add-evidence-upload", "implement-risk-export", "create-analyst-dashboard")
  - IMPORTANT: The plan lives under `specs/adw/` and ends with the `-plan.md` suffix. This is intentionally separate from the hand-authored `specs/NNNN-*.md` design docs — do NOT collide with those.
  - Create the `specs/adw/` directory if it does not exist.
- Use the `Plan Format` below to create the plan.
- Research the codebase to understand existing patterns, architecture, and conventions before planning the feature.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to implement the feature successfully.
- Use your reasoning model: THINK HARD about the feature requirements, design, and implementation approach.
- Follow existing patterns and conventions in the codebase. Don't reinvent the wheel.
- Design for extensibility and maintainability.
- IMPORTANT: This is a vendor-risk app. The final vendor-risk decision is always made by a human analyst, never automatically by the AI. Any plan that touches classification, mapping, risk scoring, or approval must preserve human-in-the-loop control.
- If you need a new dependency, install it in the right workspace (`npm --prefix server install <pkg>` or `npm --prefix client install <pkg>`) and be sure to report it in the `Notes` section of the `Plan Format`.
- Keep it simple. Respect TypeScript strict mode and Biome formatting (the repo uses `npm run check`).
- IMPORTANT: If the feature includes UI components or user interactions:
  - Add a task in the `Step by Step Tasks` section to create a separate E2E test file in `.claude/commands/e2e/test_<descriptive_name>.md` based on examples in that directory
  - Add E2E test validation to your Validation Commands section
  - IMPORTANT: When you fill out the `Plan Format: Relevant Files` section, add an instruction to read `.claude/commands/test_e2e.md`, and `.claude/commands/e2e/test_basic_assessment.md` to understand how to create an E2E test file. List your new E2E test file to the `Plan Format: New Files` section.
  - To be clear, we're not creating a new E2E test file, we're creating a task to create a new E2E test file in the `Plan Format` below
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
# Spec — <feature title>

- **Status:** Draft
- **Branch:** <branch name for this ADW run>
- **Location:** <comma-separated list of files to be touched / created>
- **Related docs:** <relevant specs/NNNN-*.md, README.md sections, API_CONTRACT.md>

## Problem / Objective
<describe the feature in detail, including its purpose and value to users. Include a short User Story (As a <user> / I want to <goal> / So that <benefit>) and a clear Problem Statement.>

## Approach & Changes
<describe the proposed solution approach and how it solves the problem. List the relevant files and why they matter in bullet points. If new files are required, list them in an h3 'New Files' section.>

### Implementation Plan
<break the work into phases: Foundation, Core Implementation, Integration. Describe each.>

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. Order matters: start with the foundational shared changes then move on to the specific implementation. Include creating tests throughout the implementation process.>

<If the feature affects UI, include a task to create an E2E test file (like `.claude/commands/e2e/test_basic_assessment.md`) as one of your early tasks. That e2e test should validate the feature works as expected; be specific with the steps to demonstrate the new functionality. We want the minimal set of steps to validate the feature works and screenshots to prove it if possible.>

<Your last step should be running the Verification commands to validate the feature works correctly with zero regressions.>

## Key Decisions & Rationale
<list the important design decisions made and why. Note any tradeoffs and rejected alternatives.>

## Verification
Execute every command to validate the feature works correctly with zero regressions.

### Unit Tests & Edge Cases
<describe unit tests needed for the feature and the edge cases that must be covered.>

### Acceptance Criteria
<list specific, measurable criteria that must be met for the feature to be considered complete.>

### Validation Commands
<list commands you'll use to validate with 100% confidence the feature is implemented correctly with zero regressions. Every command must execute without errors.>

<If you created an E2E test, include the following validation step: `Read .claude/commands/test_e2e.md`, then read and execute your new E2E `.claude/commands/e2e/test_<descriptive_name>.md` test file to validate this functionality works.>

- `npm run check` - Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` - Server + client TypeScript type checks
- `npm run test` - Server + client unit tests
- `npm run build` - Client production build

## Known Limitations / Follow-ups
<optionally list any additional notes, future considerations, or context relevant to the feature that will help the developer.>
```

## Feature
Extract the feature details from the `issue_json` variable (parse the JSON and use the title and body fields).

## Report

- IMPORTANT: Return exclusively the path to the plan file created and nothing else.
