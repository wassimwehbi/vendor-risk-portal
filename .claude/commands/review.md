# Review

Follow the `Instructions` below to **review work done against a plan-spec file** (`specs/adw/*-plan.md`) to ensure implemented features match requirements. Use the plan-spec to understand the requirements and then use the git diff to understand the changes made. Browse the running application and capture screenshots of critical functionality paths as documented in the `Instructions` section. If there are issues, report them; if not, report success.

## Variables

adw_id: $1
spec_file: $2 if provided, otherwise discover it from the git diff
agent_name: $3 if provided, otherwise use 'review_agent'
review_image_dir: `<absolute path to worktree>/agents/<adw_id>/reviewer/review_img/`

## Instructions

- Check the current git branch using `git branch` to understand context.
- Run `git diff origin/main` to see all changes made in the current branch. Continue even if there are no changes related to the spec file.
- Find the plan-spec file: if `spec_file` was not provided, look for a `specs/adw/*-plan.md` file in the diff that matches the current branch / adw_id.
- Read the identified plan-spec file to understand requirements (its **Problem / Objective**, **Approach & Changes**, **Verification**, and **Acceptance Criteria**).
- IMPORTANT: If the work can be validated via UI validation (if not, skip this section):
  - Browse the running application (see `Setup`) and validate the work visually.
  - Look for corresponding E2E test files in `.claude/commands/e2e/test_*.md` that mirror the feature name.
  - Use E2E test files only as navigation guides for screenshot locations, not for other purposes.
  - IMPORTANT: To be clear, we're not testing. We know the functionality works. We're reviewing the implementation against the plan-spec to make sure it matches what was requested.
  - NOTE: For UX-facing work, a separate UX Validation phase (`/ux_validate`, spec 0012) owns the before/after visual-evidence audit and the deterministic `ux` regression check. Do NOT duplicate exhaustive visual diffing here — capture only the spec-critical screenshots needed to confirm the implementation matches the plan.
  - IMPORTANT: Take screenshots along the way to showcase the new functionality and any issues you find.
    - Use the **chrome-devtools MCP** tools to drive the browser and capture screenshots if they are available; otherwise fall back to **Playwright** (`npx playwright`).
    - Capture visual proof of working features through targeted screenshots.
    - Navigate to the application and capture screenshots of only the critical paths based on the plan-spec.
    - Compare implemented changes with plan-spec requirements to verify correctness.
    - Do not take screenshots of the entire process, only the critical points.
    - IMPORTANT: Aim for `1-5` screenshots to showcase that the new functionality works as specified.
    - If there is a review issue, take a screenshot of the issue and add it to the `review_issues` array. Describe the issue, resolution, and severity.
    - Number your screenshots in the order they are taken like `01_<descriptive name>.png`, `02_<descriptive name>.png`, etc.
    - IMPORTANT: Be absolutely sure to take a screenshot of the critical point of the new functionality.
    - IMPORTANT: Save / copy all screenshots into the provided `review_image_dir` (`agents/<adw_id>/reviewer/review_img/`). Create the directory if it doesn't exist. Use full absolute paths.
    - Focus only on critical functionality paths - avoid unnecessary screenshots.
    - Use descriptive filenames that indicate what part of the change is being verified.
- IMPORTANT: Issue Severity Guidelines
  - Think hard about the impact of the issue on the feature and the user. This is a vendor-risk app — treat anything that breaks the human-in-the-loop approval contract, leaks PII, or produces an incorrect risk result as a blocker.
  - Guidelines:
    - `skippable` - the issue is a non-blocker for the work to be released but is still a problem.
    - `tech_debt` - the issue is a non-blocker for the work to be released but will create technical debt that should be addressed in the future.
    - `blocker` - the issue is a blocker for the work to be released and should be addressed immediately. It will harm the user experience or will not function as expected.
- IMPORTANT: Return ONLY the JSON object with the review result.
  - IMPORTANT: Output your result in JSON format based on the `Report` section below.
  - IMPORTANT: Do not include any additional text, explanations, or markdown formatting.
  - We'll immediately run JSON.parse() on the output, so make sure it's valid JSON.
- Ultra think as you work through the review process. Focus on the critical functionality paths and the user experience. Don't report issues if they are not critical to the feature.

## Setup

Prepare and browse the running application:

1. If `.ports.env` exists at the repo/worktree root, source it: `source .ports.env`. This exports the worktree dev ports — `PORT` (backend) and `CLIENT_DEV_PORT` (frontend) — plus `API_PROXY_TARGET` and `VRP_DB_PATH`.
2. Start the app on the worktree dev ports in the background, e.g. `nohup npm run dev > /tmp/review-<adw_id>.log 2>&1 &` (this honors `PORT` / `CLIENT_DEV_PORT` / `API_PROXY_TARGET` from `.ports.env`). If `.ports.env` is absent, the defaults are backend `4100` / frontend `5173`.
3. The application frontend URL is `http://localhost:<CLIENT_DEV_PORT>` (default `5173`). Wait until it responds before browsing.
4. Browse to `http://localhost:<CLIENT_DEV_PORT>` using the chrome-devtools MCP tools (or Playwright) and capture screenshots into `review_image_dir`.

## Report

- IMPORTANT: Return results exclusively as a JSON object based on the `Output Structure` section below.
- `success` should be `true` if there are NO BLOCKING issues (implementation matches the plan-spec for critical functionality).
- `success` should be `false` ONLY if there are BLOCKING issues that prevent the work from being released.
- `review_issues` can contain issues of any severity (skippable, tech_debt, or blocker).
- `screenshots` should ALWAYS contain paths to screenshots showcasing the new functionality, regardless of success status. Use full absolute paths.
- This allows subsequent agents to quickly identify and resolve blocking errors while documenting all issues.

### Output Structure

```json
{
    "success": "boolean - true if there are NO BLOCKING issues (can have skippable/tech_debt issues), false if there are BLOCKING issues",
    "review_summary": "string - 2-4 sentences describing what was built and whether it matches the plan-spec. Written as if reporting during a standup meeting. Example: 'The evidence-upload feature has been implemented with drag-and-drop intake and parsed extraction display. The implementation matches the plan-spec requirements for type-checking and preserves the human-in-the-loop approval flow. Minor UI polish could be improved but all core functionality works as specified.'",
    "review_issues": [
        {
            "review_issue_number": "number - the issue number based on the index of this issue",
            "screenshot_path": "string - /absolute/path/to/screenshot_that_shows_review_issue.png",
            "issue_description": "string - description of the issue",
            "issue_resolution": "string - description of the resolution",
            "issue_severity": "string - severity of the issue between 'skippable', 'tech_debt', 'blocker'"
        }
    ],
    "screenshots": [
        "string - /absolute/path/to/screenshot_showcasing_functionality.png",
        "string - /absolute/path/to/screenshot_showcasing_functionality.png"
    ]
}
```
