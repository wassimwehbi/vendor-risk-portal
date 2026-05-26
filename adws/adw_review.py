#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Review (isolated) — review the implementation against the plan-spec,
capture screenshots, and patch blockers.

Usage:
  uv run adws/adw_review.py <issue-number> <adw-id> [--skip-resolution]
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from adw_modules.agent import execute_template
from adw_modules.data_types import AgentTemplateRequest, ReviewResult
from adw_modules.git_ops import commit_changes, finalize_git_operations
from adw_modules.github import fetch_issue, get_repo_url, extract_repo_path
from adw_modules.workflow_ops import (
    create_commit,
    create_and_implement_patch,
    find_spec_file,
    classify_issue,
)
from adw_modules.utils import setup_logger, check_env_vars, parse_json
from adw_modules.phase import load_state_or_exit, require_worktree_or_ci, post

AGENT_REVIEWER = "sdlc_reviewer"
MAX_REVIEW_ATTEMPTS = 3


def run_review(adw_id, spec_file, working_dir):
    return execute_template(
        AgentTemplateRequest(
            agent_name=AGENT_REVIEWER,
            slash_command="/review",
            args=[adw_id, spec_file or ""],
            adw_id=adw_id,
            working_dir=working_dir,
        )
    )


def main():
    load_dotenv()

    skip_resolution = "--skip-resolution" in sys.argv
    if skip_resolution:
        sys.argv.remove("--skip-resolution")

    if len(sys.argv) < 3:
        print("Usage: uv run adws/adw_review.py <issue-number> <adw-id> [--skip-resolution]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2]

    logger = setup_logger(adw_id, "adw_review")
    state = load_state_or_exit(adw_id, "adw_review", logger)
    issue_number = state.get("issue_number", issue_number)
    check_env_vars(logger)
    worktree_path = require_worktree_or_ci(adw_id, state, logger, issue_number)

    spec_file = find_spec_file(state, logger)
    post(issue_number, adw_id, AGENT_REVIEWER, "🔍 Reviewing implementation against the plan-spec…")

    blockers_remaining = []
    for attempt in range(1, MAX_REVIEW_ATTEMPTS + 1):
        response = run_review(adw_id, spec_file, worktree_path)
        if not response.success:
            post(issue_number, adw_id, AGENT_REVIEWER, f"❌ Review error: {response.output}")
            break
        try:
            result = parse_json(response.output, ReviewResult)
        except Exception as e:
            logger.error(f"Could not parse review result: {e}")
            break

        blockers = [i for i in result.review_issues if i.issue_severity == "blocker"]
        post(issue_number, adw_id, AGENT_REVIEWER, f"Review: {result.review_summary} ({len(blockers)} blockers)")
        blockers_remaining = blockers
        if not blockers or skip_resolution or attempt == MAX_REVIEW_ATTEMPTS:
            break

        # Patch the blockers, then re-review.
        for b in blockers:
            create_and_implement_patch(
                adw_id,
                f"{b.issue_description}\nResolution: {b.issue_resolution}",
                logger,
                AGENT_REVIEWER,
                AGENT_REVIEWER,
                spec_path=spec_file,
                working_dir=worktree_path,
            )

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        logger.error(f"Error getting repo URL: {e}")
        sys.exit(1)

    issue = fetch_issue(issue_number, repo_path)
    issue_command = state.get("issue_class") or "/feature"
    commit_msg, error = create_commit(AGENT_REVIEWER, issue, issue_command, adw_id, logger, worktree_path)
    if not error:
        commit_changes(commit_msg, cwd=worktree_path)
        finalize_git_operations(state, logger, cwd=worktree_path)

    state.save("adw_review")
    if blockers_remaining and not skip_resolution:
        post(issue_number, adw_id, "ops", f"❌ Review completed with {len(blockers_remaining)} unresolved blockers")
        state.to_stdout()
        sys.exit(1)
    post(issue_number, adw_id, "ops", "✅ Review phase completed")
    state.to_stdout()


if __name__ == "__main__":
    main()
