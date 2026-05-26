"""Shared helpers for ADW phase scripts.

Centralizes the worktree-vs-CI execution context and resilient issue commenting
so each phase script stays small.

When ADW_IN_CI=true (the GitHub Actions trigger), phases operate *in place* on a
feature branch in the checked-out repo instead of spawning a git worktree — the
ephemeral CI runner is already isolated, and worktrees there only complicate port
allocation.
"""

import os
import sys
import logging
from typing import Optional

from adw_modules.state import ADWState
from adw_modules.github import make_issue_comment
from adw_modules.worktree_ops import validate_worktree


def is_in_ci() -> bool:
    """True when running inside the GitHub Actions trigger (in-place mode)."""
    return os.getenv("ADW_IN_CI", "").lower() == "true"


def project_root() -> str:
    """Absolute path to the repository root (parent of adws/)."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def working_dir_for(state: ADWState) -> str:
    """Working directory for agent execution: the worktree, or repo root in CI."""
    return state.get("worktree_path") or project_root()


def post(issue_number: Optional[str], adw_id: str, agent: str, message: str) -> None:
    """Post a tracked issue comment, best-effort (never crash a workflow on this)."""
    from adw_modules.workflow_ops import format_issue_message

    if not issue_number:
        return
    try:
        make_issue_comment(issue_number, format_issue_message(adw_id, agent, message))
    except Exception as e:  # noqa: BLE001 - comments are non-critical
        print(f"(issue comment skipped: {e})", file=sys.stderr)


def require_worktree_or_ci(
    adw_id: str, state: ADWState, logger: logging.Logger, issue_number: Optional[str]
) -> str:
    """Resolve the working dir for a dependent phase.

    In CI we work in place (repo root). Otherwise we require a valid worktree and
    exit if it's missing.
    """
    if is_in_ci():
        return project_root()

    valid, error = validate_worktree(adw_id, state)
    if not valid:
        logger.error(f"Worktree validation failed: {error}")
        post(
            issue_number,
            adw_id,
            "ops",
            f"❌ Worktree validation failed: {error}. Run adw_plan.py first.",
        )
        sys.exit(1)
    return state.get("worktree_path")


def load_state_or_exit(
    adw_id: str, phase: str, logger: logging.Logger
) -> ADWState:
    """Load existing state for a dependent phase, or exit with guidance."""
    state = ADWState.load(adw_id, logger)
    if not state:
        logger.error(f"No state found for ADW ID: {adw_id}")
        logger.error("Run adw_plan.py first to create the state (and worktree).")
        sys.exit(1)
    state.append_adw_id(phase)
    return state
