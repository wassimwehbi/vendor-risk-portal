# Document Feature

Generate concise markdown documentation for implemented features by analyzing code changes and the plan-spec. This command creates documentation in the `app_docs/` directory based on git diff analysis against the main branch and the original feature plan-spec.

## Variables

adw_id: $1
spec_path: $2 if provided, otherwise leave it blank
documentation_screenshots_dir: $3 if provided, otherwise leave it blank

## Instructions

### 1. Analyze Changes
- Run `git diff origin/main --stat` to see files changed and lines modified
- Run `git diff origin/main --name-only` to get the list of changed files
- For significant changes (>50 lines), run `git diff origin/main <file>` on specific files to understand the implementation details

### 2. Read the Plan-Spec (if provided)
- If `spec_path` is provided (typically a `specs/adw/*-plan.md` file), read it to understand:
  - Original requirements and objective
  - Expected functionality
  - Acceptance criteria
- Use this to frame the documentation around what was requested vs what was built

### 3. Analyze and Copy Screenshots (if provided)
- If `documentation_screenshots_dir` is provided, list and examine the screenshots
- Create the `app_docs/` directory if it doesn't exist, then create `app_docs/assets/` if it doesn't exist
- Copy all screenshot files (*.png) from `documentation_screenshots_dir` to `app_docs/assets/`
  - Preserve original filenames
  - Use the `cp` command to copy files
- Use the visual context to better describe UI changes or visual features
- Reference screenshots in documentation using relative paths (e.g., `assets/screenshot-name.png`)

### 4. Generate Documentation
- Create the `app_docs/` directory if it doesn't exist
- Create a new documentation file in the `app_docs/` directory
- Filename format: `feature-{adw_id}-{descriptive-slug}.md`
  - Replace `{descriptive-slug}` with a short feature name (e.g., "evidence-upload", "risk-export", "analyst-dashboard")
- Follow the Documentation Format below
- Focus on:
  - What was built (based on the git diff)
  - How it works (technical implementation)
  - How to use it (user perspective)
  - Any configuration or setup required

### 5. Final Output
- When you finish writing the documentation, return exclusively the path to the documentation file created and nothing else

## Documentation Format

```md
# <Feature Title>

**ADW ID:** <adw_id>
**Date:** <current date>
**Plan-Spec:** <spec_path or "N/A">

## Overview

<2-3 sentence summary of what was built and why>

## Screenshots

<If documentation_screenshots_dir was provided and screenshots were copied>

![<Description>](assets/<screenshot-filename.png>)

## What Was Built

<List the main components/features implemented based on the git diff analysis>

- <Component/feature 1>
- <Component/feature 2>
- <etc>

## Technical Implementation

### Files Modified

<List key files changed with a brief description of changes>

- `<file_path>`: <what was changed/added>
- `<file_path>`: <what was changed/added>

### Key Changes

<Describe the most important technical changes in 3-5 bullet points>

## How to Use

<Step-by-step instructions for using the new feature>

1. <Step 1>
2. <Step 2>
3. <etc>

## Configuration

<Any configuration options, environment variables, or settings>

## Testing

<Brief description of how to test the feature — reference `npm run check`, `npm run typecheck`, `npm run test`, `npm run build`, and any E2E spec>

## Notes

<Any additional context, limitations, or future considerations. Remember: AI output is preliminary; the final vendor-risk decision is always made by a human analyst.>
```

## Report

- IMPORTANT: Return exclusively the path to the documentation file created and nothing else.
