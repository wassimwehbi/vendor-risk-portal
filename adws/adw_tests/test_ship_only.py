#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.7", "python-dotenv>=1.0", "requests>=2.32"]
# ///
"""Unit tests for the ship-only (`adw:ship`) trigger path.

Run: `uv run adws/adw_tests/test_ship_only.py`
"""

import os
import sys

# Put the adws/ directory on the path so `adw_modules` / `adw_triggers` import.
ADWS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ADWS_DIR)

from adw_modules.workflow_ops import adw_id_from_branch  # noqa: E402
from adw_modules.git_ops import filter_adw_pr_branches  # noqa: E402
from adw_triggers import trigger_cron  # noqa: E402


class _Label:
    def __init__(self, name):
        self.name = name


class _Issue:
    def __init__(self, number, labels):
        self.number = number
        self.labels = [_Label(n) for n in labels]


def test_adw_id_from_branch():
    assert adw_id_from_branch("feature-issue-42-adw-ab12cd34-some-slug") == "ab12cd34"
    assert adw_id_from_branch("bug-issue-7-adw-deadbeef-fix") == "deadbeef"
    assert adw_id_from_branch("not-an-adw-branch") is None
    assert adw_id_from_branch("") is None
    assert adw_id_from_branch(None) is None


def test_filter_adw_pr_branches():
    prs = [
        {"number": 10, "headRefName": "feature-issue-42-adw-aaa11122-x"},
        {"number": 11, "headRefName": "some-human-branch"},
        {"number": 12, "headRefName": "bug-issue-7-adw-bbb22233-y"},
    ]
    assert filter_adw_pr_branches(prs, 42) == [("feature-issue-42-adw-aaa11122-x", "10")]
    assert filter_adw_pr_branches(prs, 99) == []
    # Issue number must not match as a substring of another issue's number.
    assert filter_adw_pr_branches(prs, 4) == []
    multi = [
        {"number": 1, "headRefName": "feature-issue-5-adw-aaa11122-x"},
        {"number": 2, "headRefName": "bug-issue-5-adw-bbb22233-y"},
    ]
    assert len(filter_adw_pr_branches(multi, 5)) == 2


def _qualifies(labels, pr_open, latest_body=""):
    """Run trigger_cron.qualifies with stubbed PR + comment lookups."""
    orig_fetch = trigger_cron.fetch_issue_comments
    orig_has_pr = trigger_cron.has_open_adw_pr
    trigger_cron.fetch_issue_comments = lambda repo, num: (
        [{"id": 1, "body": latest_body}] if latest_body else []
    )
    trigger_cron.has_open_adw_pr = lambda repo, num: pr_open
    try:
        return trigger_cron.qualifies(_Issue(1, labels), "owner/repo", {})
    finally:
        trigger_cron.fetch_issue_comments = orig_fetch
        trigger_cron.has_open_adw_pr = orig_has_pr


def test_qualifies_guard_inversion():
    # adw:ship requires an open PR.
    assert _qualifies(["adw:ship"], pr_open=True)[0] == "ship"
    assert _qualifies(["adw:ship"], pr_open=False)[0] is None
    # adw:zte must NOT double-run when a PR already exists.
    assert _qualifies(["adw:zte"], pr_open=True)[0] is None
    assert _qualifies(["adw:zte"], pr_open=False)[0] == "zte"


def test_qualifies_ship_wins_and_freeze_blocks():
    # Both labels present + open PR → ship wins.
    assert _qualifies(["adw:zte", "adw:ship"], pr_open=True)[0] == "ship"
    # Freeze is an absolute kill-switch.
    assert _qualifies(["adw:ship", "adw:freeze"], pr_open=True)[0] is None
    # The magic `adw` comment still drives the full pipeline (no PR yet).
    assert _qualifies([], pr_open=False, latest_body="adw please ship")[0] == "zte"


def main():
    tests = [
        test_adw_id_from_branch,
        test_filter_adw_pr_branches,
        test_qualifies_guard_inversion,
        test_qualifies_ship_wins_and_freeze_blocks,
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
    print(f"\nAll {len(tests)} ship-only tests passed")


if __name__ == "__main__":
    main()
