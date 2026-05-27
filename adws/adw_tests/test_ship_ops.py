#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.7", "python-dotenv>=1.0", "requests>=2.32"]
# ///
"""Unit tests for the ship loop's required-check evaluation (spec 0016).

Covers the distinction between "checks pending" (a run exists but hasn't concluded)
and "checks missing" (no run on the head SHA at all — the push never triggered CI),
and the grace-gated `missing` result from `wait_for_required_checks`. No network: the
status-check fetch is stubbed. Run: `uv run adws/adw_tests/test_ship_ops.py`
"""

import logging
import os
import sys

ADWS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ADWS_DIR)

from adw_modules import ship_ops  # noqa: E402
from adw_modules.data_types import CheckRun  # noqa: E402

LOG = logging.getLogger("test_ship_ops")
REQUIRED = ["quality", "e2e"]


def cr(name, conclusion=None, status="COMPLETED"):
    return CheckRun(name=name, status=status, conclusion=conclusion)


# ── evaluate_checks (pure) ──────────────────────────────────────────────────


def test_all_green():
    runs = [cr("quality", "SUCCESS"), cr("e2e", "SUCCESS")]
    assert ship_ops.evaluate_checks(runs, REQUIRED) == ("green", [])


def test_neutral_and_skipped_are_green():
    runs = [cr("quality", "NEUTRAL"), cr("e2e", "SKIPPED")]
    assert ship_ops.evaluate_checks(runs, REQUIRED) == ("green", [])


def test_failing_reported():
    runs = [cr("quality", "SUCCESS"), cr("e2e", "FAILURE")]
    assert ship_ops.evaluate_checks(runs, REQUIRED) == ("failing", ["e2e"])


def test_absent_check_is_missing_not_pending():
    # e2e has no run at all and nothing is in-progress → actionable "missing".
    runs = [cr("quality", "SUCCESS")]
    assert ship_ops.evaluate_checks(runs, REQUIRED) == ("missing", ["e2e"])


def test_in_progress_beats_missing():
    # quality still running, e2e absent → keep waiting (CI is alive), not "missing".
    runs = [cr("quality", conclusion=None, status="IN_PROGRESS")]
    assert ship_ops.evaluate_checks(runs, REQUIRED) == ("pending", [])


def test_cancelled_is_pending():
    runs = [cr("quality", "SUCCESS"), cr("e2e", "CANCELLED")]
    assert ship_ops.evaluate_checks(runs, REQUIRED) == ("pending", [])


def test_failing_beats_missing():
    # quality failed, e2e absent → failing wins (it's the strongest signal).
    runs = [cr("quality", "FAILURE")]
    assert ship_ops.evaluate_checks(runs, REQUIRED) == ("failing", ["quality"])


# ── wait_for_required_checks (stubbed fetch) ────────────────────────────────


class _StubChecks:
    """Patch ship_ops.get_required_check_runs + pin the required set for a test."""

    def __init__(self, runs):
        self.runs = runs

    def __enter__(self):
        self._orig = ship_ops.get_required_check_runs
        self._env = os.environ.get("ADW_REQUIRED_CHECKS")
        os.environ["ADW_REQUIRED_CHECKS"] = ",".join(REQUIRED)
        ship_ops.get_required_check_runs = lambda *a, **k: self.runs
        return self

    def __exit__(self, *exc):
        ship_ops.get_required_check_runs = self._orig
        if self._env is None:
            os.environ.pop("ADW_REQUIRED_CHECKS", None)
        else:
            os.environ["ADW_REQUIRED_CHECKS"] = self._env


def test_wait_returns_missing_after_grace():
    # All checks absent; grace 0 → first poll classifies as missing and returns it.
    with _StubChecks([]):
        result, names = ship_ops.wait_for_required_checks(
            "1", LOG, timeout_min=1, interval_sec=0, missing_grace_sec=0
        )
    assert result == "missing", result
    assert names == REQUIRED, names


def test_wait_returns_green():
    with _StubChecks([cr("quality", "SUCCESS"), cr("e2e", "SUCCESS")]):
        result, names = ship_ops.wait_for_required_checks(
            "1", LOG, timeout_min=1, interval_sec=0, missing_grace_sec=0
        )
    assert result == "green", result


def test_wait_returns_failing():
    with _StubChecks([cr("quality", "SUCCESS"), cr("e2e", "FAILURE")]):
        result, names = ship_ops.wait_for_required_checks(
            "1", LOG, timeout_min=1, interval_sec=0, missing_grace_sec=0
        )
    assert result == "failing" and names == ["e2e"], (result, names)


def test_wait_times_out_while_pending():
    # In-progress and no time budget (timeout_min=0) → returns timeout, never "missing".
    with _StubChecks([cr("quality", conclusion=None, status="IN_PROGRESS")]):
        result, names = ship_ops.wait_for_required_checks(
            "1", LOG, timeout_min=0, interval_sec=0, missing_grace_sec=0
        )
    assert result == "timeout", result


def main():
    tests = [
        test_all_green,
        test_neutral_and_skipped_are_green,
        test_failing_reported,
        test_absent_check_is_missing_not_pending,
        test_in_progress_beats_missing,
        test_cancelled_is_pending,
        test_failing_beats_missing,
        test_wait_returns_missing_after_grace,
        test_wait_returns_green,
        test_wait_returns_failing,
        test_wait_times_out_while_pending,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    if failed:
        print(f"\n{failed} test(s) failed")
        sys.exit(1)
    print(f"\nAll {len(tests)} ship_ops tests passed")


if __name__ == "__main__":
    main()
