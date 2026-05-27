#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Plan (isolated) — classify an issue, branch, plan, and open a draft PR.

Usage:
  uv run adws/adw_plan.py <issue-number> [adw-id]

Creates a git worktree under trees/<adw_id>/ (or, when ADW_IN_CI=true, works in
place on a branch in the checked-out repo), classifies the issue, generates a
branch, writes a plan-spec under specs/adw/, commits it, and pushes + opens a PR.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import glob
import json
import re
from dotenv import load_dotenv

from adw_modules.state import ADWState
from adw_modules.git_ops import (
    commit_changes,
    create_branch,
    finalize_git_operations,
)
from adw_modules.github import fetch_issue, get_repo_url, extract_repo_path
from adw_modules.workflow_ops import (
    classify_issue,
    build_plan,
    generate_branch_name,
    create_commit,
    ensure_adw_id,
    AGENT_PLANNER,
)
from adw_modules.utils import setup_logger, check_env_vars
from adw_modules.data_types import GitHubIssue, AgentTemplateRequest
from adw_modules.agent import execute_template
from adw_modules.worktree_ops import (
    create_worktree,
    validate_worktree,
    get_ports_for_adw,
    is_port_available,
    find_next_available_ports,
    setup_worktree_environment,
    PortSet,
)
from adw_modules.phase import is_in_ci, project_root, post


def resolve_plan_file(raw_output: str, worktree_path: str) -> str | None:
    """Resolve the plan-spec the planner created, robust to model output quirks.

    The planning agent is asked to return only the path, but in practice it may
    wrap it in backticks/quotes, add prose, or mis-order the filename. So we
    sanitize the returned string, and if that path doesn't exist, fall back to
    discovering the most recently written specs/adw/*-plan.md in the worktree.
    Returns a worktree-relative path, or None if nothing is found.
    """
    text = (raw_output or "").strip()
    # Prefer an explicit specs/adw/...-plan.md path mentioned in the output.
    m = re.search(r"(specs/adw/[^\s`\"']+\.md)", text)
    candidate = m.group(1) if m else text.strip("`\"' \n")

    if candidate:
        abs_candidate = (
            candidate if os.path.isabs(candidate)
            else os.path.join(worktree_path, candidate)
        )
        if os.path.exists(abs_candidate):
            return os.path.relpath(abs_candidate, worktree_path)

    # Fallback: the planner created the file but reported a bad path — find it.
    matches = glob.glob(os.path.join(worktree_path, "specs/adw/*-plan.md"))
    if matches:
        matches.sort(key=os.path.getmtime, reverse=True)
        return os.path.relpath(matches[0], worktree_path)
    return None


def main():
    load_dotenv()

    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_plan.py <issue-number> [adw-id]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2] if len(sys.argv) > 2 else None

    temp_logger = setup_logger(adw_id, "adw_plan") if adw_id else None
    adw_id = ensure_adw_id(issue_number, adw_id, temp_logger)

    state = ADWState.load(adw_id, temp_logger)
    if not state.get("adw_id"):
        state.update(adw_id=adw_id)
    state.append_adw_id("adw_plan")

    logger = setup_logger(adw_id, "adw_plan")
    logger.info(f"ADW Plan Iso starting - ID: {adw_id}, Issue: {issue_number}, CI: {is_in_ci()}")

    check_env_vars(logger)

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        logger.error(f"Error getting repository URL: {e}")
        sys.exit(1)

    in_ci = is_in_ci()

    # Resolve / allocate the execution context (worktree or in-place CI).
    worktree_path = None
    if not in_ci:
        valid, _ = validate_worktree(adw_id, state)
        if valid:
            logger.info(f"Using existing worktree for {adw_id}")
            worktree_path = state.get("worktree_path")
        else:
            ports = get_ports_for_adw(adw_id)
            if not all(
                is_port_available(p)
                for p in (ports.backend, ports.frontend, ports.e2e_server, ports.e2e_client)
            ):
                logger.warning("Deterministic ports in use; finding alternatives")
                ports = find_next_available_ports(adw_id)
            logger.info(f"Allocated ports: {ports}")
            state.update(
                backend_port=ports.backend,
                frontend_port=ports.frontend,
                e2e_server_port=ports.e2e_server,
                e2e_client_port=ports.e2e_client,
            )
            state.save("adw_plan")

    issue: GitHubIssue = fetch_issue(issue_number, repo_path)
    post(issue_number, adw_id, "ops", "✅ Starting planning phase")

    # Classify
    issue_command, error = classify_issue(issue, adw_id, logger)
    if error:
        logger.error(f"Error classifying issue: {error}")
        post(issue_number, adw_id, "ops", f"❌ Error classifying issue: {error}")
        sys.exit(1)
    state.update(issue_class=issue_command)
    state.save("adw_plan")
    post(issue_number, adw_id, "ops", f"✅ Issue classified as: {issue_command}")

    # Plan-time UX detection (text-only — heuristic, before any code exists). Biases the
    # plan toward UX scenarios; refined authoritatively from the diff later (spec 0012).
    try:
        from adw_modules import ux_detection

        ux_signal = ux_detection.detect_from_issue(issue)
        ux_detection.record_to_state(state, ux_signal)
        if ux_signal.is_ux_work:
            post(
                issue_number, adw_id, "ops",
                f"🎨 UX work likely ({ux_signal.summary()}) — the plan should include UX scenarios + acceptance criteria.",
            )
    except Exception as e:  # noqa: BLE001 - detection is advisory; never block planning
        logger.warning(f"UX detection skipped: {e}")

    # Branch name
    branch_name, error = generate_branch_name(issue, issue_command, adw_id, logger)
    if error:
        logger.error(f"Error generating branch name: {error}")
        post(issue_number, adw_id, "ops", f"❌ Error generating branch name: {error}")
        sys.exit(1)
    state.update(branch_name=branch_name)
    state.save("adw_plan")

    # Establish the branch + working directory.
    if in_ci:
        worktree_path = project_root()
        ok, error = create_branch(branch_name, cwd=worktree_path)
        if not ok:
            logger.error(f"Error creating branch in place: {error}")
            post(issue_number, adw_id, "ops", f"❌ Error creating branch: {error}")
            sys.exit(1)
        logger.info(f"[CI] Working in place on branch {branch_name}")
    elif not worktree_path:
        worktree_path, error = create_worktree(adw_id, branch_name, logger)
        if error:
            logger.error(f"Error creating worktree: {error}")
            post(issue_number, adw_id, "ops", f"❌ Error creating worktree: {error}")
            sys.exit(1)
        state.update(worktree_path=worktree_path)
        state.save("adw_plan")

        # Reuse the ports already allocated + saved above (don't re-resolve, which
        # could drift under contention).
        ports = PortSet(
            backend=state.get("backend_port"),
            frontend=state.get("frontend_port"),
            e2e_server=state.get("e2e_server_port"),
            e2e_client=state.get("e2e_client_port"),
        )
        db_path = setup_worktree_environment(worktree_path, ports, logger)
        state.update(db_path=db_path)
        state.save("adw_plan")

        install_request = AgentTemplateRequest(
            agent_name="ops",
            slash_command="/install_worktree",
            args=[
                worktree_path,
                str(ports.backend),
                str(ports.frontend),
                str(ports.e2e_server),
                str(ports.e2e_client),
            ],
            adw_id=adw_id,
            working_dir=worktree_path,
        )
        install_response = execute_template(install_request)
        if not install_response.success:
            logger.error(f"Error setting up worktree: {install_response.output}")
            post(issue_number, adw_id, "ops", f"❌ Error setting up worktree: {install_response.output}")
            sys.exit(1)

    post(issue_number, adw_id, "ops", f"✅ Working in: {worktree_path}")

    # Build the plan
    post(issue_number, adw_id, AGENT_PLANNER, "✅ Building implementation plan")
    plan_response = build_plan(issue, issue_command, adw_id, logger, working_dir=worktree_path)
    if not plan_response.success:
        logger.error(f"Error building plan: {plan_response.output}")
        post(issue_number, adw_id, AGENT_PLANNER, f"❌ Error building plan: {plan_response.output}")
        sys.exit(1)

    plan_file_path = resolve_plan_file(plan_response.output, worktree_path)
    if not plan_file_path:
        logger.error(f"Could not locate plan-spec. Planner output: {plan_response.output[:300]}")
        post(issue_number, adw_id, "ops", "❌ Could not locate the plan-spec under specs/adw/")
        sys.exit(1)

    state.update(plan_file=plan_file_path)
    state.save("adw_plan")
    post(issue_number, adw_id, "ops", f"✅ Plan file created: {plan_file_path}")

    # Commit the plan
    commit_msg, error = create_commit(AGENT_PLANNER, issue, issue_command, adw_id, logger, worktree_path)
    if error:
        logger.error(f"Error creating commit message: {error}")
        post(issue_number, adw_id, AGENT_PLANNER, f"❌ Error creating commit message: {error}")
        sys.exit(1)
    ok, error = commit_changes(commit_msg, cwd=worktree_path)
    if not ok:
        logger.error(f"Error committing plan: {error}")
        post(issue_number, adw_id, AGENT_PLANNER, f"❌ Error committing plan: {error}")
        sys.exit(1)
    post(issue_number, adw_id, AGENT_PLANNER, "✅ Plan committed")

    # Push + open/refresh PR
    finalize_git_operations(state, logger, cwd=worktree_path)

    state.save("adw_plan")
    post(issue_number, adw_id, "ops", "✅ Planning phase completed")
    state.to_stdout()


if __name__ == "__main__":
    main()
