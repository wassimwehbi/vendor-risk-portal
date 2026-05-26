#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Test (isolated) — run check/typecheck/test/build (+ optional E2E), with
automatic failure resolution, then commit results.

Usage:
  uv run adws/adw_test.py <issue-number> <adw-id> [--skip-e2e]
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from adw_modules.git_ops import commit_changes, finalize_git_operations
from adw_modules.github import fetch_issue, get_repo_url, extract_repo_path
from adw_modules.workflow_ops import create_commit, classify_issue
from adw_modules.utils import setup_logger, check_env_vars
from adw_modules.phase import load_state_or_exit, require_worktree_or_ci, post
from adw_modules.test_ops import (
    AGENT_TESTER,
    run_tests_with_resolution,
    run_e2e_tests_with_resolution,
    format_test_results_comment,
)


def main():
    load_dotenv()

    skip_e2e = "--skip-e2e" in sys.argv
    if skip_e2e:
        sys.argv.remove("--skip-e2e")

    if len(sys.argv) < 3:
        print("Usage: uv run adws/adw_test.py <issue-number> <adw-id> [--skip-e2e]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2]

    logger = setup_logger(adw_id, "adw_test")
    state = load_state_or_exit(adw_id, "adw_test", logger)
    issue_number = state.get("issue_number", issue_number)
    logger.info(f"ADW Test Iso - ID: {adw_id}, Issue: {issue_number}, skip_e2e={skip_e2e}")

    check_env_vars(logger)
    worktree_path = require_worktree_or_ci(adw_id, state, logger, issue_number)

    post(issue_number, adw_id, AGENT_TESTER, "🧪 Running tests (check → typecheck → test → build)…")
    results, passed, failed, _ = run_tests_with_resolution(
        adw_id, issue_number, logger, worktree_path
    )
    if results:
        post(issue_number, adw_id, AGENT_TESTER, format_test_results_comment(results, passed, failed))

    e2e_failed = 0
    if not skip_e2e:
        post(issue_number, adw_id, "e2e_test_runner", "🌐 Running E2E tests…")
        _, _, e2e_failed = run_e2e_tests_with_resolution(adw_id, issue_number, logger, worktree_path)

    total_failures = failed + (e2e_failed if not skip_e2e else 0)

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        logger.error(f"Error getting repo URL: {e}")
        sys.exit(1)

    issue = fetch_issue(issue_number, repo_path)
    issue_command = state.get("issue_class")
    if not issue_command:
        issue_command, error = classify_issue(issue, adw_id, logger)
        if error:
            issue_command = "/feature"
        else:
            state.update(issue_class=issue_command)
            state.save("adw_test")

    commit_msg, error = create_commit(AGENT_TESTER, issue, issue_command, adw_id, logger, worktree_path)
    if not error:
        commit_changes(commit_msg, cwd=worktree_path)
        finalize_git_operations(state, logger, cwd=worktree_path)

    state.save("adw_test")
    if total_failures > 0:
        post(issue_number, adw_id, "ops", f"❌ Test phase completed with {total_failures} failures")
        state.to_stdout()
        sys.exit(1)
    post(issue_number, adw_id, "ops", "✅ All tests passed")
    state.to_stdout()


if __name__ == "__main__":
    main()
