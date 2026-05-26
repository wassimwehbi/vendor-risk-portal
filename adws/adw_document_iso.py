#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Document (isolated) — generate feature documentation under app_docs/.

Usage:
  uv run adws/adw_document_iso.py <issue-number> <adw-id>
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from adw_modules.agent import execute_template
from adw_modules.data_types import AgentTemplateRequest
from adw_modules.git_ops import commit_changes, finalize_git_operations
from adw_modules.github import fetch_issue, get_repo_url, extract_repo_path
from adw_modules.workflow_ops import create_commit, find_spec_file
from adw_modules.utils import setup_logger, check_env_vars
from adw_modules.phase import load_state_or_exit, require_worktree_or_ci, post

AGENT_DOCUMENTER = "sdlc_documenter"


def main():
    load_dotenv()
    if len(sys.argv) < 3:
        print("Usage: uv run adws/adw_document_iso.py <issue-number> <adw-id>")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2]

    logger = setup_logger(adw_id, "adw_document_iso")
    state = load_state_or_exit(adw_id, "adw_document_iso", logger)
    issue_number = state.get("issue_number", issue_number)
    check_env_vars(logger)
    worktree_path = require_worktree_or_ci(adw_id, state, logger, issue_number)

    spec_file = find_spec_file(state, logger)
    post(issue_number, adw_id, AGENT_DOCUMENTER, "📝 Generating feature documentation…")
    response = execute_template(
        AgentTemplateRequest(
            agent_name=AGENT_DOCUMENTER,
            slash_command="/document",
            args=[adw_id, spec_file or ""],
            adw_id=adw_id,
            working_dir=worktree_path,
        )
    )
    if not response.success:
        post(issue_number, adw_id, AGENT_DOCUMENTER, f"❌ Documentation error: {response.output}")
        # Non-fatal: documentation failure should not block shipping.

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        logger.error(f"Error getting repo URL: {e}")
        sys.exit(1)

    issue = fetch_issue(issue_number, repo_path)
    issue_command = state.get("issue_class") or "/feature"
    commit_msg, error = create_commit(AGENT_DOCUMENTER, issue, issue_command, adw_id, logger, worktree_path)
    if not error:
        commit_changes(commit_msg, cwd=worktree_path)
        finalize_git_operations(state, logger, cwd=worktree_path)

    state.save("adw_document_iso")
    post(issue_number, adw_id, "ops", "✅ Documentation phase completed")
    state.to_stdout()


if __name__ == "__main__":
    main()
