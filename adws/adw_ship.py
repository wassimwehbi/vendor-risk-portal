#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Ship (isolated) — zero-touch shipping via PR, with Copilot iteration.

Ships through a PR so branch protection (quality, e2e, docker, CodeQL) actually
runs, then:
  1. ensures the branch is pushed and a PR is open,
  2. waits for the required checks to go green (auto-fixing quality/e2e failures),
  3. reads GitHub Copilot's review feedback and resolves high-importance items,
  4. loops until checks are green AND no high-importance Copilot feedback remains,
  5. squash-merges to main (Mode A: no human approval is required on this repo).

Usage:
  uv run adws/adw_ship.py <issue-number> <adw-id>
    [--max-ship-iters N] [--checks-timeout MIN] [--dry-run] [--admin] [--no-copilot]
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from adw_modules.state import ADWState
from adw_modules.git_ops import (
    get_pr_number,
    get_pr_state,
    merge_pr,
    push_branch,
    commit_changes,
    finalize_git_operations,
)
from adw_modules.github import (
    fetch_issue,
    get_repo_url,
    extract_repo_path,
    get_pr_head_sha,
    update_pr_branch,
    request_copilot_review,
    fetch_copilot_comments,
    add_pr_label,
)
from adw_modules.workflow_ops import create_commit
from adw_modules.utils import setup_logger, check_env_vars
from adw_modules.phase import load_state_or_exit, working_dir_for, post
from adw_modules.ship_ops import wait_for_required_checks
from adw_modules import ux_detection
from adw_modules.test_ops import run_tests_with_resolution, run_e2e_tests_with_resolution
from adw_modules import copilot_ops

AGENT_SHIPPER = "shipper"
NEEDS_HUMAN_LABEL = "adw:needs-human"


def _pop_int_flag(name: str, default: int) -> int:
    if name in sys.argv:
        i = sys.argv.index(name)
        try:
            val = int(sys.argv[i + 1])
        except (IndexError, ValueError):
            print(f"Error: {name} requires an integer value")
            sys.exit(1)
        del sys.argv[i : i + 2]
        return val
    return default


def abort_to_human(pr_number, issue_number, adw_id, logger, reason: str):
    logger.error(f"Aborting to human: {reason}")
    if pr_number:
        add_pr_label(pr_number, NEEDS_HUMAN_LABEL)
    post(issue_number, adw_id, AGENT_SHIPPER, f"🛑 Needs human attention: {reason}")
    sys.exit(1)


def commit_and_push(issue, issue_class, adw_id, logger, working_dir, branch_name):
    """Commit current changes and push (idempotent).

    create_commit drives the /commit agent (which stages + commits); we then call
    commit_changes as a deterministic fallback so an uncommitted auto-fix still
    lands a commit. commit_changes is a no-op when the tree is already clean, so a
    push is never a no-op spin while files remain uncommitted.
    """
    create_commit(AGENT_SHIPPER, issue, issue_class, adw_id, logger, working_dir)
    commit_changes(
        f"{AGENT_SHIPPER}: {issue_class}: address review feedback", cwd=working_dir
    )
    ok, err = push_branch(branch_name, cwd=working_dir)
    if not ok:
        logger.warning(f"push after resolve returned: {err}")


def main():
    load_dotenv()

    max_iters = _pop_int_flag("--max-ship-iters", 5)
    checks_timeout = _pop_int_flag("--checks-timeout", 45)
    dry_run = "--dry-run" in sys.argv
    admin = "--admin" in sys.argv or os.getenv("ADW_MERGE_ADMIN", "").lower() == "true"
    no_copilot = "--no-copilot" in sys.argv
    for f in ("--dry-run", "--admin", "--no-copilot"):
        if f in sys.argv:
            sys.argv.remove(f)

    if len(sys.argv) < 3:
        print("Usage: uv run adws/adw_ship.py <issue-number> <adw-id> [flags]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2]

    if os.getenv("ADW_DISABLED", "").lower() == "true":
        print("ADW_DISABLED=true — ship is disabled; exiting.")
        sys.exit(0)

    logger = setup_logger(adw_id, "adw_ship")
    state = load_state_or_exit(adw_id, "adw_ship", logger)
    issue_number = state.get("issue_number", issue_number)
    check_env_vars(logger)

    branch_name = state.get("branch_name")
    if not branch_name:
        logger.error("No branch_name in state; run the plan/build phases first")
        sys.exit(1)
    working_dir = working_dir_for(state)
    issue_class = state.get("issue_class") or "/feature"

    # Gate on the deterministic `ux` check only when UX work is detected (spec 0012).
    # Authoritative diff (fails open) OR'd with any prior detection. Non-UX runs unaffected.
    is_ux_work = bool(state.get("is_ux_work")) or ux_detection.detect_from_diff(working_dir).is_ux_work
    if is_ux_work:
        gate = os.getenv("ADW_UX_GATE", "block").lower()
        logger.info(f"UX work detected; `ux` check is {'required' if gate != 'advisory' else 'advisory'}")

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        logger.error(f"Error getting repo URL: {e}")
        sys.exit(1)
    issue = fetch_issue(issue_number, repo_path)

    post(issue_number, adw_id, AGENT_SHIPPER, "🚢 Starting zero-touch ship")

    # Ensure the branch is pushed and a PR exists (plan/build already opens one).
    finalize_git_operations(state, logger, cwd=working_dir)
    pr_number = get_pr_number(branch_name)
    if not pr_number:
        abort_to_human(None, issue_number, adw_id, logger, f"No open PR found for {branch_name}")
    logger.info(f"Shipping PR #{pr_number} (max_iters={max_iters}, dry_run={dry_run}, admin={admin})")

    processed_comment_ids: set = set()

    for iteration in range(1, max_iters + 1):
        logger.info(f"=== Ship iteration {iteration}/{max_iters} ===")

        # Keep the branch up to date (branch protection is strict).
        pr_state = get_pr_state(pr_number) or {}
        if pr_state.get("merged"):
            logger.info("PR already merged; nothing to do")
            post(issue_number, adw_id, AGENT_SHIPPER, "✅ PR already merged")
            return
        if pr_state.get("mergeable") == "CONFLICTING":
            abort_to_human(pr_number, issue_number, adw_id, logger, "PR has merge conflicts")
        if pr_state.get("mergeStateStatus") == "BEHIND":
            logger.info("Branch behind base; updating")
            update_pr_branch(pr_number)
            # Updating creates a new head commit → CI re-runs; re-evaluate next loop.

        # 1) Wait for required checks.
        result, failing = wait_for_required_checks(pr_number, logger, timeout_min=checks_timeout, is_ux_work=is_ux_work)
        if result == "timeout":
            abort_to_human(pr_number, issue_number, adw_id, logger, "required checks did not complete in time")
        if result == "failing":
            if iteration == max_iters:
                abort_to_human(pr_number, issue_number, adw_id, logger, f"checks still failing: {failing}")
            fixable = [c for c in failing if c in ("quality", "e2e")]
            unfixable = [c for c in failing if c not in ("quality", "e2e")]
            if not fixable:
                abort_to_human(
                    pr_number, issue_number, adw_id, logger,
                    f"CI failing on non-auto-fixable checks: {unfixable}",
                )
            post(issue_number, adw_id, AGENT_SHIPPER, f"🔧 Fixing failing checks: {failing}")
            run_tests_with_resolution(adw_id, issue_number, logger, working_dir)
            if "e2e" in failing:
                run_e2e_tests_with_resolution(adw_id, issue_number, logger, working_dir)
            commit_and_push(issue, issue_class, adw_id, logger, working_dir, branch_name)
            continue

        # 2) Checks green → handle Copilot feedback.
        if no_copilot:
            logger.info("Copilot iteration disabled (--no-copilot)")
        else:
            comments = fetch_copilot_comments(pr_number)
            new_comments = [c for c in comments if c.id not in processed_comment_ids]
            copilot_ops.classify(new_comments)
            to_resolve = copilot_ops.actionable(new_comments)

            if to_resolve:
                post(issue_number, adw_id, AGENT_SHIPPER,
                     f"🤖 Addressing {len(to_resolve)} Copilot comment(s)")
                res = copilot_ops.resolve_copilot_feedback(
                    adw_id, pr_number, to_resolve, working_dir, logger
                )
                for c in new_comments:
                    processed_comment_ids.add(c.id)

                if res is None:
                    if iteration == max_iters:
                        abort_to_human(pr_number, issue_number, adw_id, logger,
                                       "could not run Copilot resolver")
                    continue

                if res.changed_files:
                    commit_and_push(issue, issue_class, adw_id, logger, working_dir, branch_name)
                    request_copilot_review(pr_number)
                    if res.remaining_high and iteration == max_iters:
                        abort_to_human(pr_number, issue_number, adw_id, logger,
                                       f"unresolved high-importance Copilot items: {res.remaining_high}")
                    continue  # re-run checks + re-review on the new commit
                if res.remaining_high:
                    abort_to_human(pr_number, issue_number, adw_id, logger,
                                   f"high-importance Copilot items could not be resolved: {res.remaining_high}")
                # else: nothing to change, no remaining high → clean.

        # 3) Green + no actionable Copilot feedback → merge (unless dry-run).
        if dry_run:
            post(issue_number, adw_id, AGENT_SHIPPER,
                 "🟢 Dry run: checks green and Copilot clean — stopping before merge")
            logger.info("Dry run complete; not merging")
            state.save("adw_ship")
            state.to_stdout()
            return

        pr_state = get_pr_state(pr_number) or {}
        if pr_state.get("mergeStateStatus") == "BEHIND":
            update_pr_branch(pr_number)
            continue  # re-wait after update

        ok, error = merge_pr(pr_number, logger, "squash", delete_branch=True, admin=admin)
        if not ok:
            if iteration == max_iters:
                abort_to_human(pr_number, issue_number, adw_id, logger, f"merge failed: {error}")
            logger.warning(f"Merge attempt failed: {error}; retrying")
            continue

        post(issue_number, adw_id, AGENT_SHIPPER,
             f"🎉 Shipped! Squash-merged PR #{pr_number} to main and deleted the branch.")
        state.save("adw_ship")
        state.to_stdout()
        return

    abort_to_human(pr_number, issue_number, adw_id, logger,
                   f"exhausted {max_iters} ship iterations without a clean merge")


if __name__ == "__main__":
    main()
