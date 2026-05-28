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
    """Classify the required checks on a PR's head commit.

    Returns ``(state, names)`` where ``state`` is one of:
      ``"failing"`` — ≥1 required check concluded red; ``names`` = the red checks.
      ``"pending"`` — ≥1 required check is actively running (QUEUED / IN_PROGRESS, or
                      CANCELLED — superseded by a newer run under cancel-in-progress);
                      keep waiting.
      ``"missing"`` — nothing is running, yet ≥1 required check has NO run at all on the
                      head SHA; ``names`` = those checks. The push almost certainly did
                      not trigger CI — actionable: re-trigger with a fresh head SHA.
      ``"green"``   — every required check succeeded (or was neutral / skipped).

    Priority is failing > pending > missing > green: an absent check is only actionable
    once nothing is still running, since a freshly-pushed head registers its runs over a
    few seconds, during which the required checks are transiently absent.
    """
    by_name = {r.name: r for r in runs}
    failing: List[str] = []
    missing: List[str] = []
    in_progress = False

    for name in required:
        r = by_name.get(name)
        if r is None:
            missing.append(name)
            continue
        conclusion = (r.conclusion or "").upper()
        if conclusion in (
            "FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR", "STALE"
        ):
            failing.append(name)
        elif conclusion == "CANCELLED":
            in_progress = True
        elif conclusion in ("SUCCESS", "NEUTRAL", "SKIPPED"):
            continue
        else:
            # Not concluded yet (QUEUED / IN_PROGRESS / empty).
            in_progress = True

    if failing:
        return "failing", failing
    if in_progress:
        return "pending", []
    if missing:
        return "missing", missing
    return "green", []


def wait_for_required_checks(
    pr_number: str,
    logger: logging.Logger,
    timeout_min: int = 45,
    interval_sec: int = 30,
    is_ux_work: bool = False,
    missing_grace_sec: int = 120,
) -> Tuple[str, List[str]]:
    """Poll required checks until green / failing / missing or timeout.

    Returns ``(result, names)`` where ``result`` is
    ``'green' | 'failing' | 'missing' | 'timeout'``. ``'missing'`` is returned only
    once the required checks have stayed absent with nothing running for
    ``missing_grace_sec`` — CI registers its runs within seconds of a push, so
    sustained silence means the push never triggered it. The caller then re-triggers
    CI (a fresh head SHA) rather than burning the full timeout waiting for runs that
    will never appear.
    """
    required = required_checks(is_ux_work)
    start = time.time()
    deadline = start + timeout_min * 60
    while time.time() < deadline:
        runs = get_required_check_runs(pr_number, required)
        state, names = evaluate_checks(runs, required)
        logger.info(f"Checks state={state} names={names}")
        if state == "green":
            return "green", []
        if state == "failing":
            return "failing", names
        if state == "missing" and (time.time() - start) >= missing_grace_sec:
            logger.warning(f"Required checks never started on the head commit: {names}")
            return "missing", names
        time.sleep(interval_sec)
    logger.warning("Timed out waiting for required checks")
    return "timeout", []
