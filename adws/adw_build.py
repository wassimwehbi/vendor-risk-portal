#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Build (isolated) — implement the plan in the worktree.

Usage:
  uv run adws/adw_build.py <issue-number> <adw-id>

Requires adw_plan.py to have run first (state + worktree must exist).
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import subprocess
from dotenv import load_dotenv

from adw_modules.git_ops import commit_changes, finalize_git_operations
from adw_modules.github import fetch_issue, get_repo_url, extract_repo_path
from adw_modules.workflow_ops import (
    implement_plan,
    create_commit,
    classify_issue,
    AGENT_IMPLEMENTOR,
)
from adw_modules.utils import setup_logger, check_env_vars
from adw_modules.phase import load_state_or_exit, require_worktree_or_ci, post


def main():
    load_dotenv()

    if len(sys.argv) < 3:
        print("Usage: uv run adws/adw_build.py <issue-number> <adw-id>")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2]

    logger = setup_logger(adw_id, "adw_build")
    state = load_state_or_exit(adw_id, "adw_build", logger)
    issue_number = state.get("issue_number", issue_number)
    logger.info(f"ADW Build Iso starting - ID: {adw_id}, Issue: {issue_number}")

    check_env_vars(logger)
    worktree_path = require_worktree_or_ci(adw_id, state, logger, issue_number)

    if not state.get("branch_name"):
        post(issue_number, adw_id, "ops", "❌ No branch in state — run adw_plan.py first")
        sys.exit(1)
    if not state.get("plan_file"):
        post(issue_number, adw_id, "ops", "❌ No plan file in state — run adw_plan.py first")
        sys.exit(1)

    branch_name = state.get("branch_name")
    result = subprocess.run(
        ["git", "checkout", branch_name], capture_output=True, text=True, cwd=worktree_path
    )
    if result.returncode != 0:
        logger.error(f"Failed to checkout {branch_name}: {result.stderr}")
        post(issue_number, adw_id, "ops", f"❌ Failed to checkout branch {branch_name}")
        sys.exit(1)

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        logger.error(f"Error getting repo URL: {e}")
        sys.exit(1)

    plan_file = state.get("plan_file")
    post(issue_number, adw_id, AGENT_IMPLEMENTOR, "✅ Implementing solution")
    implement_response = implement_plan(plan_file, adw_id, logger, working_dir=worktree_path)
    if not implement_response.success:
        logger.error(f"Error implementing: {implement_response.output}")
        post(issue_number, adw_id, AGENT_IMPLEMENTOR, f"❌ Error implementing: {implement_response.output}")
        sys.exit(1)
    post(issue_number, adw_id, AGENT_IMPLEMENTOR, "✅ Solution implemented")

    issue = fetch_issue(issue_number, repo_path)
    issue_command = state.get("issue_class")
    if not issue_command:
        issue_command, error = classify_issue(issue, adw_id, logger)
        if error:
            issue_command = "/feature"
            logger.warning("Defaulting to /feature after classification error")
        else:
            state.update(issue_class=issue_command)
            state.save("adw_build")

    commit_msg, error = create_commit(AGENT_IMPLEMENTOR, issue, issue_command, adw_id, logger, worktree_path)
    if error:
        logger.error(f"Error creating commit message: {error}")
        post(issue_number, adw_id, AGENT_IMPLEMENTOR, f"❌ Error creating commit message: {error}")
        sys.exit(1)
    ok, error = commit_changes(commit_msg, cwd=worktree_path)
    if not ok:
        logger.error(f"Error committing implementation: {error}")
        post(issue_number, adw_id, AGENT_IMPLEMENTOR, f"❌ Error committing: {error}")
        sys.exit(1)
    post(issue_number, adw_id, AGENT_IMPLEMENTOR, "✅ Implementation committed")

    finalize_git_operations(state, logger, cwd=worktree_path)
    state.save("adw_build")
    post(issue_number, adw_id, "ops", "✅ Implementation phase completed")
    state.to_stdout()


if __name__ == "__main__":
    main()
