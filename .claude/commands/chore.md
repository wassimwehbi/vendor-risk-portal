# Chore Planning

Create a new plan to resolve the `Chore` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files. Follow the `Report` section to properly report the results of your work.

## Variables
issue_number: $1
adw_id: $2
issue_json: $3

## Instructions

- IMPORTANT: You're writing a plan to resolve a chore based on the `Chore` that will add value to the application.
- IMPORTANT: The `Chore` describes the chore that will be resolved but remember we're not resolving the chore, we're creating the plan that will be used to resolve the chore based on the `Plan Format` below.
- You're writing a plan to resolve a chore, it should be simple but we need to be thorough and precise so we don't miss anything or waste time with any second round of changes.
- Create the plan in the `specs/adw/` directory with filename: `issue-{issue_number}-adw-{adw_id}-{descriptive-slug}-plan.md`
  - Replace `{descriptive-slug}` with a short, descriptive slug based on the chore (e.g., "update-readme", "bump-dependencies", "refactor-auth")
  - IMPORTANT: The plan lives under `specs/adw/` and ends with the `-plan.md` suffix. This is intentionally separate from the hand-authored `specs/NNNN-*.md` design docs — do NOT collide with those.
  - Create the `specs/adw/` directory if it does not exist.
- Use the plan format below to create the plan.
- Research the codebase and put together a plan to accomplish the chore.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to accomplish the chore.
- Use your reasoning model: THINK HARD about the plan and the steps to accomplish the chore.
- Keep it simple. Respect TypeScript strict mode and Biome formatting (the repo uses `npm run check`).
- IMPORTANT: If the chore is UX-facing (touches `client/src/**`, styling, layout, responsive behavior, or accessibility), the plan MUST include a `UX Scenarios, Acceptance & Evidence Checklist` section (UX scenarios + viewports, measurable acceptance criteria, before/after screenshots). The ADW UX validation phase (`/ux_validate`) audits the rendered result and the deterministic `ux` check (`npm run test:ux`, manifest `e2e/ux/scenarios.ts`) gates merge — see `specs/0012-ux-tasks-harness.md`.
- Respect requested files in the `Relevant Files` section.
- Start your research by reading the `README.md` file.
- `adws/**` contain the AI Developer Workflow scripts; consult `adws/README.md` if the chore touches them.
- When you finish creating the plan for the chore, follow the `Report` section to properly report the results of your work.

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
# Spec — <chore title>

- **Status:** Draft
- **Branch:** <branch name for this ADW run>
- **Location:** <comma-separated list of files to be touched / created>
- **Related docs:** <relevant specs/NNNN-*.md, README.md sections, API_CONTRACT.md>

## Problem / Objective
<describe the chore in detail and the value it provides.>

## Approach & Changes
<describe how you'll accomplish the chore. List the relevant files and why they matter in bullet points. If new files are required, list them in an h3 'New Files' section.>

### Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. Order matters: start with the foundational shared changes then move on to the specific changes. Your last step should be running the Verification commands to validate the chore is complete with zero regressions.>

## Key Decisions & Rationale
<list any notable decisions and why. For a simple chore this may be brief.>

## Verification
Execute every command to validate the chore is complete with zero regressions. Don't validate with curl commands.

- `npm run check` - Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` - Server + client TypeScript type checks
- `npm run test` - Server + client unit tests
- `npm run build` - Client production build

## Known Limitations / Follow-ups
<optionally list any additional notes or context relevant to the chore that will help the developer.>
```

## Chore
Extract the chore details from the `issue_json` variable (parse the JSON and use the title and body fields).

## Report

- IMPORTANT: Return exclusively the path to the plan file created and nothing else.
