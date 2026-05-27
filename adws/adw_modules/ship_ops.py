"""CI status-check polling for the zero-touch ship loop.

The ship loop waits on these checks before merging — quality, e2e, docker,
"Analyze (javascript-typescript)" (CodeQL), and experiments — independently of whether
GitHub branch protection is configured to require each one. We poll the PR's
statusCheckRollup on its current head commit until they go green, fail, or time out.
"""

import os
import time
import logging
from typing import List, Tuple

from adw_modules.github import get_required_check_runs

DEFAULT_REQUIRED_CHECKS = [
    "quality",
    "e2e",
    "docker",
    "Analyze (javascript-typescript)",
    # Config-as-code gate for the A/B platform (spec 0015, validate-experiments.yml).
    # Always runs to a conclusion on every PR, so it is safe to wait on unconditionally.
    "experiments",
]

# The deterministic UX regression check (spec 0012, .github/workflows/ux-regression.yml).
# Added to the waited-on set ONLY when UX work is detected, so non-UX runs are unaffected.
UX_CHECK_NAME = "ux"


def required_checks(is_ux_work: bool = False) -> List[str]:
    """Required checks, overridable via ADW_REQUIRED_CHECKS (comma-separated).

    When UX work is detected, the deterministic ``ux`` check is appended unless
    ``ADW_UX_GATE`` is ``advisory`` (default ``block``). ``ux`` is intentionally not
    in the auto-fixable set — a red ``ux`` aborts to a human (visual regressions need eyes).
    """
    raw = os.getenv("ADW_REQUIRED_CHECKS")
    base = [c.strip() for c in raw.split(",") if c.strip()] if raw else list(DEFAULT_REQUIRED_CHECKS)
    gate = os.getenv("ADW_UX_GATE", "block").lower()
    if is_ux_work and gate != "advisory" and UX_CHECK_NAME not in base:
        base.append(UX_CHECK_NAME)
    return base


def evaluate_checks(runs, required: List[str]) -> Tuple[str, List[str]]:
    """Return ('green'|'failing'|'pending', failing_names).

    A CANCELLED conclusion is treated as pending: CI uses cancel-in-progress, so a
    cancelled run was superseded by a newer one on a fresh push.
    """
    by_name = {r.name: r for r in runs}
    failing: List[str] = []
    pending = False

    for name in required:
        r = by_name.get(name)
        if r is None:
            pending = True
            continue
        conclusion = (r.conclusion or "").upper()
        status = (r.status or "").upper()
        if conclusion in (
            "FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR", "STALE"
        ):
            failing.append(name)
        elif conclusion == "CANCELLED":
            pending = True
        elif conclusion in ("SUCCESS", "NEUTRAL", "SKIPPED"):
            continue
        else:
            # Not concluded yet (QUEUED / IN_PROGRESS / empty).
            pending = True

    if failing:
        return "failing", failing
    if pending:
        return "pending", []
    return "green", []


def wait_for_required_checks(
    pr_number: str,
    logger: logging.Logger,
    timeout_min: int = 45,
    interval_sec: int = 30,
    is_ux_work: bool = False,
) -> Tuple[str, List[str]]:
    """Poll required checks until green/failing or timeout.

    Returns ('green'|'failing'|'timeout', failing_names).
    """
    required = required_checks(is_ux_work)
    deadline = time.time() + timeout_min * 60
    while time.time() < deadline:
        runs = get_required_check_runs(pr_number, required)
        state, failing = evaluate_checks(runs, required)
        logger.info(f"Checks state={state} failing={failing}")
        if state == "green":
            return "green", []
        if state == "failing":
            return "failing", failing
        time.sleep(interval_sec)
    logger.warning("Timed out waiting for required checks")
    return "timeout", []
