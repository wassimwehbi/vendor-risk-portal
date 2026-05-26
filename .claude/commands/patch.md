# Patch Plan

Create a **focused patch plan** to resolve a specific issue based on the `review_change_request`. Follow the `Instructions` to create a concise plan that addresses the issue with minimal, targeted changes.

## Variables

adw_id: $1
review_change_request: $2
spec_path: $3 if provided, otherwise leave it blank
agent_name: $4 if provided, otherwise use 'patch_agent'
issue_screenshots: $ARGUMENTS (optional) - comma-separated list of screenshot paths if provided

## Instructions

- IMPORTANT: You're creating a patch plan to fix a specific review issue. Keep changes small, focused, and targeted.
- Read the original specification (spec) file at `spec_path` if provided to understand the context and requirements.
- IMPORTANT: Use the `review_change_request` to understand exactly what needs fixing and use it as the basis for your patch plan.
- If `issue_screenshots` are provided, examine them to better understand the visual context of the issue.
- Create the patch plan in the `specs/adw/` directory with filename: `patch-adw-{adw_id}-{descriptive-slug}-plan.md`
  - Replace `{descriptive-slug}` with a short name based on the issue (e.g., "fix-button-color", "update-validation", "correct-layout")
  - IMPORTANT: The plan lives under `specs/adw/` and ends with the `-plan.md` suffix. This is intentionally separate from the hand-authored `specs/NNNN-*.md` design docs — do NOT collide with those.
  - Create the `specs/adw/` directory if it does not exist.
- IMPORTANT: This is a PATCH - keep the scope minimal. Only fix what's described in the `review_change_request` and nothing more. Address only the `review_change_request`.
- Run `git diff --stat`. If changes are available, use them to understand what's been done in the codebase so you can detail the exact changes in the patch plan.
- Ultra think about the most efficient way to implement the solution with minimal code changes.
- IMPORTANT: This is a vendor-risk app. The final vendor-risk decision is always made by a human analyst, never automatically by the AI. Do not change that contract while patching.
- Base your `Verification` on the validation steps from `spec_path` if provided.
  - If any tests fail in the validation steps, you must fix them.
  - If not provided, READ `.claude/commands/test.md: ## Test Execution Sequence` and execute the tests to understand the tests that need to be run to validate the patch.
- Replace every <placeholder> in the `Plan Format` with specific implementation details.
- IMPORTANT: When you finish writing the patch plan, return exclusively the path to the patch plan file created and nothing else.

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
# Spec — Patch: <concise patch title>

- **Status:** Draft
- **Branch:** <branch name for this ADW run>
- **Location:** <comma-separated list of files to be touched — be specific and minimal>
- **Related docs:** <spec_path if provided, relevant specs/NNNN-*.md, API_CONTRACT.md>

## Problem / Objective
**Original Spec:** <spec_path or "N/A">
**Issue:** <brief description of the review issue based on the `review_change_request`>
**Solution:** <brief description of the solution approach based on the `review_change_request`>

## Approach & Changes
### Files to Modify
<list only the files that need changes - be specific and minimal>

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

<list 2-5 focused steps to implement the patch. Each step should be a concrete action.>

### Step 1: <specific action>
- <implementation detail>
- <implementation detail>

### Step 2: <specific action>
- <implementation detail>
- <implementation detail>

<continue as needed, but keep it minimal>

## Key Decisions & Rationale
**Lines of code to change:** <estimate>
**Risk level:** <low|medium|high>
**Testing required:** <brief description>

## Verification
Execute every command to validate the patch is complete with zero regressions.

<list 1-5 specific commands or checks to verify the patch works correctly. Prefer the repo verification commands:>

- `npm run check` - Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` - Server + client TypeScript type checks
- `npm run test` - Server + client unit tests
- `npm run build` - Client production build

## Known Limitations / Follow-ups
<optionally note anything intentionally left out of scope for this patch.>
```

## Report

- IMPORTANT: Return exclusively the path to the patch plan file created and nothing else.
