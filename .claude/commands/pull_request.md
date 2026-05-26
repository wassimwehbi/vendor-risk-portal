# Create Pull Request

Based on the `Instructions` below, take the `Variables` follow the `Run` section to create a pull request. Then follow the `Report` section to report the results of your work.

## Variables

branch_name: $1
issue: $2
plan_file: $3
adw_id: $4

## Instructions

- Generate a pull request title in the format: `<issue_type>: #<issue_number> - <issue_title>`
- The PR body should include:
  - A summary section with the issue context
  - Link to the implementation `plan_file` if it exists (the `specs/adw/*-plan.md` plan-spec)
  - Reference to the issue (Closes #<issue_number>)
  - ADW tracking ID
  - A checklist of what was done
  - A summary of key changes made
- IMPORTANT: Per repo convention (`CLAUDE.md`), every PR must reference a spec. Link the `plan_file` plan-spec in the PR body.
- Extract the issue number, type, and title from the issue JSON
- Examples of PR titles:
  - `feat: #123 - Add evidence upload`
  - `bug: #456 - Fix risk score regression`
  - `chore: #789 - Update dependencies`
  - `test: #1011 - Test xyz`
- Don't mention Claude Code in the PR body - let the author get credit for this.
- IMPORTANT: If you post any GitHub comment (on the PR or the issue) as part of this command, it MUST be prefixed with the literal marker `[ADW-AGENTS]` at the very start of the comment body. This marker is the loop-prevention guard read by the triggers — never omit it.

## Run

1. Run `git diff origin/main...HEAD --stat` to see a summary of changed files
2. Run `git log origin/main..HEAD --oneline` to see the commits that will be included
3. Run `git diff origin/main...HEAD --name-only` to get a list of changed files
4. Run `git push -u origin <branch_name>` to push the branch
5. Set the `GH_TOKEN` environment variable from `GITHUB_PAT` if available, then run `gh pr create --title "<pr_title>" --body "<pr_body>" --base main` to create the PR
6. Capture the PR URL from the output

## Report

Return ONLY the PR URL that was created (no other text)
