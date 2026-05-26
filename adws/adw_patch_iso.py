#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Patch (isolated) — fast path: turn an issue directly into a small,
targeted patch (no full feature plan). Creates the worktree/branch like the plan
phase, then runs /patch + /implement.

Usage:
  uv run adws/adw_patch_iso.py <issue-number> [adw-id]
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from adw_modules.state import ADWState
from adw_modules.git_ops import commit_changes, create_branch, finalize_git_operations
from adw_modules.github import fetch_issue, get_repo_url, extract_repo_path
from adw_modules.workflow_ops import (
    generate_branch_name,
    create_commit,
    create_and_implement_patch,
    ensure_adw_id,
    AGENT_IMPLEMENTOR,
)
from adw_modules.utils import setup_logger, check_env_vars
from adw_modules.data_types import GitHubIssue
from adw_modules.worktree_ops import (
    create_worktree,
    find_next_available_ports,
    setup_worktree_environment,
)
from adw_modules.phase import is_in_ci, project_root, post

AGENT_PATCHER = "sdlc_patcher"


def main():
    load_dotenv()
    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_patch_iso.py <issue-number> [adw-id]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2] if len(sys.argv) > 2 else None

    temp_logger = setup_logger(adw_id, "adw_patch_iso") if adw_id else None
    adw_id = ensure_adw_id(issue_number, adw_id, temp_logger)
    state = ADWState.load(adw_id, temp_logger)
    state.append_adw_id("adw_patch_iso")

    logger = setup_logger(adw_id, "adw_patch_iso")
    check_env_vars(logger)

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        logger.error(f"Error getting repo URL: {e}")
        sys.exit(1)

    issue: GitHubIssue = fetch_issue(issue_number, repo_path)
    state.update(issue_class="/patch")

    branch_name, error = generate_branch_name(issue, "/patch", adw_id, logger)
    if error:
        post(issue_number, adw_id, "ops", f"❌ Error generating branch name: {error}")
        sys.exit(1)
    state.update(branch_name=branch_name)
    state.save("adw_patch_iso")

    if is_in_ci():
        worktree_path = project_root()
        ok, error = create_branch(branch_name, cwd=worktree_path)
        if not ok:
            post(issue_number, adw_id, "ops", f"❌ Error creating branch: {error}")
            sys.exit(1)
    else:
        worktree_path, error = create_worktree(adw_id, branch_name, logger)
        if error:
            post(issue_number, adw_id, "ops", f"❌ Error creating worktree: {error}")
            sys.exit(1)
        state.update(worktree_path=worktree_path)
        ports = find_next_available_ports(adw_id)
        db_path = setup_worktree_environment(worktree_path, ports, logger)
        state.update(
            backend_port=ports.backend,
            frontend_port=ports.frontend,
            e2e_server_port=ports.e2e_server,
            e2e_client_port=ports.e2e_client,
            db_path=db_path,
        )
        state.save("adw_patch_iso")

    post(issue_number, adw_id, AGENT_PATCHER, "🩹 Creating + implementing patch…")
    change_request = f"{issue.title}\n\n{issue.body}"
    patch_file, implement_response = create_and_implement_patch(
        adw_id,
        change_request,
        logger,
        AGENT_PATCHER,
        AGENT_IMPLEMENTOR,
        working_dir=worktree_path,
    )
    if not implement_response.success:
        post(issue_number, adw_id, AGENT_PATCHER, f"❌ Patch failed: {implement_response.output}")
        sys.exit(1)
    state.update(plan_file=patch_file)

    commit_msg, error = create_commit(AGENT_PATCHER, issue, "/patch", adw_id, logger, worktree_path)
    if not error:
        commit_changes(commit_msg, cwd=worktree_path)
    finalize_git_operations(state, logger, cwd=worktree_path)

    state.save("adw_patch_iso")
    post(issue_number, adw_id, "ops", "✅ Patch phase completed")
    state.to_stdout()


if __name__ == "__main__":
    main()
