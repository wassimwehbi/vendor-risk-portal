#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW UX Validation (isolated, gated on detected UX work) — spec 0012.

Runs the deterministic UX regression suite (/test_ux → npm run test:ux) and an agent
visual confirmation (/ux_validate, chrome-devtools MCP with a Playwright-screenshot
fallback), then posts an idempotent, SHA-bound UX verdict comment to the PR (or the issue
if there's no PR yet). Self-skips for non-UX changes. The verdict comment is ADVISORY —
the deterministic `ux` GitHub check (+ ship gating) is what blocks merge.

Usage:
  uv run adws/adw_ux_validation.py <issue-number> <adw-id> [--skip-resolution]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from adw_modules import ux_detection
from adw_modules.git_ops import commit_changes, finalize_git_operations, get_pr_number
from adw_modules.github import (
    ADW_UX_MARKER,
    extract_repo_path,
    fetch_issue,
    get_pr_head_sha,
    get_repo_url,
    upsert_pr_comment,
    ux_marker_body,
)
from adw_modules.phase import load_state_or_exit, post, require_worktree_or_ci
from adw_modules.utils import check_env_vars, setup_logger
from adw_modules.ux_ops import (
    MAX_UX_VALIDATION_ATTEMPTS,
    format_ux_validation_comment,
    parse_ux_validation,
    run_ux_tests_with_resolution,
    run_ux_validate,
)
from adw_modules.workflow_ops import create_and_implement_patch, create_commit, find_spec_file

AGENT = "ux_validator"


def _post_verdict(state, verdict: str, body_md: str, logger) -> None:
    """Upsert the SHA-bound verdict comment to the PR; fall back to an issue comment."""
    issue_number = state.get("issue_number")
    branch = state.get("branch_name")
    pr_number = get_pr_number(branch) if branch else None
    if pr_number:
        sha = get_pr_head_sha(pr_number)
        upsert_pr_comment(pr_number, ADW_UX_MARKER, ux_marker_body(sha, verdict, body_md))
    else:
        post(issue_number, state.get("adw_id"), AGENT, f"🎨 UX Validation — {verdict}\n\n{body_md}")


def main():
    load_dotenv()

    skip_resolution = "--skip-resolution" in sys.argv
    if skip_resolution:
        sys.argv.remove("--skip-resolution")

    if len(sys.argv) < 3:
        print("Usage: uv run adws/adw_ux_validation.py <issue-number> <adw-id> [--skip-resolution]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = sys.argv[2]

    logger = setup_logger(adw_id, "adw_ux_validation")
    state = load_state_or_exit(adw_id, "adw_ux_validation", logger)
    issue_number = state.get("issue_number", issue_number)
    check_env_vars(logger)
    worktree_path = require_worktree_or_ci(adw_id, state, logger, issue_number)

    # Authoritative re-detection on the diff (fails open → treat as UX).
    signal = ux_detection.detect(working_dir=worktree_path)
    ux_detection.record_to_state(state, signal)
    logger.info(f"UX detection: is_ux_work={signal.is_ux_work} ({signal.summary()})")

    if not signal.is_ux_work:
        post(issue_number, adw_id, AGENT, f"⏭️ Non-UX change — skipping UX validation ({signal.summary()}).")
        _post_verdict(state, "NOT_APPLICABLE", "No UX-bearing files changed; UX validation skipped.", logger)
        state.to_stdout()
        sys.exit(0)

    post(issue_number, adw_id, AGENT, f"🎨 UX work detected ({signal.summary()}) — validating…")

    # 1) Deterministic UX regression suite (with bounded resolve loop).
    results, passed, failed = run_ux_tests_with_resolution(adw_id, issue_number, logger, worktree_path)
    logger.info(f"UX suite: {passed} passed / {failed} failed")

    # 2) Agent visual confirmation against the plan's UX acceptance criteria.
    spec_file = find_spec_file(state, logger)
    result = None
    for attempt in range(1, MAX_UX_VALIDATION_ATTEMPTS + 1):
        response = run_ux_validate(adw_id, spec_file, worktree_path)
        if not response.success:
            post(issue_number, adw_id, AGENT, f"❌ UX validation error: {response.output[:300]}")
            break
        result = parse_ux_validation(response.output, logger)
        if result is None:
            break
        blockers = result.blockers
        post(issue_number, adw_id, AGENT, f"UX validation: {result.verdict} ({len(blockers)} blocker findings)")
        if result.verdict != "NEEDS_FIXES" or not blockers or skip_resolution or attempt == MAX_UX_VALIDATION_ATTEMPTS:
            break
        # Patch the blocker findings, then re-validate.
        for b in blockers:
            create_and_implement_patch(
                adw_id,
                f"UX blocker: {b.description}",
                logger,
                AGENT,
                AGENT,
                spec_path=spec_file,
                working_dir=worktree_path,
            )

    # 3) Commit any fixes the resolve loop produced.
    try:
        repo_path = extract_repo_path(get_repo_url())
        issue = fetch_issue(issue_number, repo_path)
        issue_command = state.get("issue_class") or "/feature"
        commit_msg, error = create_commit(AGENT, issue, issue_command, adw_id, logger, worktree_path)
        if not error:
            commit_changes(commit_msg, cwd=worktree_path)
            finalize_git_operations(state, logger, cwd=worktree_path)
    except Exception as e:  # noqa: BLE001 - commit is best-effort; the CI ux check is the gate
        logger.warning(f"UX validation commit skipped: {e}")

    # 4) Post the advisory SHA-bound verdict.
    if result is not None:
        verdict = result.verdict
        body = format_ux_validation_comment(result)
        if failed:
            body += f"\n\n_Deterministic UX suite: {passed} passed / {failed} failed (see the `ux` check)._"
        _post_verdict(state, verdict, body, logger)
        unresolved = len(result.blockers)
        if unresolved and not skip_resolution:
            post(issue_number, adw_id, "ops", f"⚠️ UX validation: {unresolved} unresolved blocker finding(s) — see the `ux` check / verdict comment")
        else:
            post(issue_number, adw_id, "ops", "✅ UX validation phase completed")
    else:
        # Refresh the SHA-bound comment so a prior SHA's verdict can't linger as authoritative.
        _post_verdict(
            state,
            "NEEDS_FIXES",
            "UX validation agent returned no parseable verdict — advisory. See the `ux` check and the run logs.",
            logger,
        )
        post(issue_number, adw_id, "ops", "⚠️ UX validation produced no parseable verdict (advisory)")

    # (is_ux_work/ux_signal were already recorded above; no need to re-persist.)
    state.to_stdout()


if __name__ == "__main__":
    main()
