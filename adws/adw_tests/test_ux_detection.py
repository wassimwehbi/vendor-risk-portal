#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.7", "python-dotenv>=1.0", "requests>=2.32"]
# ///
"""Unit tests for UX-work detection (spec 0012).

Run: `uv run adws/adw_tests/test_ux_detection.py`
"""

import os
import sys
import tempfile
from datetime import datetime

ADWS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ADWS_DIR)

from adw_modules.agent import SLASH_COMMAND_MODEL_MAP  # noqa: E402
from adw_modules.data_types import ADWStateData, GitHubIssue, GitHubLabel, GitHubUser, UxSignal  # noqa: E402
from adw_modules.state import CORE_FIELDS  # noqa: E402
from adw_modules import ux_detection as ux  # noqa: E402


def _issue(title="", body="", labels=None) -> GitHubIssue:
    return GitHubIssue(
        number=1,
        title=title,
        body=body,
        state="open",
        author=GitHubUser(login="tester"),
        labels=[GitHubLabel(id=str(i), name=n, color="ededed") for i, n in enumerate(labels or [])],
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        url="https://example.test/1",
    )


def test_is_ux_path():
    for p in (
        "client/src/pages/Dashboard.tsx",
        "client/src/components/FindingRow.tsx",
        "client/src/lib/format.ts",
        "client/src/index.css",
        "client/tailwind.config.ts",
        "e2e/ux/scenarios.ts",
    ):
        assert ux.is_ux_path(p), f"expected UX path: {p}"
    for p in (
        "server/src/routes/auth.ts",
        "client/src/components/RiskBadge.test.tsx",
        "client/src/types.d.ts",
        "README.md",
        "adws/adw_modules/ux_detection.py",
    ):
        assert not ux.is_ux_path(p), f"expected non-UX path: {p}"


def test_keyword_signal_requires_two_distinct():
    assert set(ux.keyword_signal("Fix button alignment", "")) == {"button", "alignment"}
    assert ux.keyword_signal("Improve documentation wording", "") == []
    # Word boundary: 'ui' must not match inside 'rebuild'.
    assert "ui" not in ux.keyword_signal("Rebuild the api layer", "")
    assert ux.keyword_signal("UI tweak", "") == ["ui"]


def test_label_signal():
    assert ux.label_signal(["ux", "backend"]) == ["ux"]
    assert ux.label_signal(["UI", "Design"]) == ["design", "ui"]
    assert ux.label_signal(["bug"]) == []


def test_screenshot_signal():
    assert ux.screenshot_signal("see ![shot](https://x/y.png)")
    assert ux.screenshot_signal("https://github.com/user-attachments/assets/abc")
    assert not ux.screenshot_signal("no images here")


def test_combine_authoritative_diff_wins():
    sig = ux.combine(UxSignal(diff_paths_hit=["client/src/pages/X.tsx"]))
    assert sig.is_ux_work is True


def test_combine_screenshot_alone_is_weak():
    assert ux.combine(UxSignal(has_screenshots=True)).is_ux_work is False
    assert ux.combine(UxSignal(has_screenshots=True, label_hits=["ux"])).is_ux_work is True


def test_fail_open_on_non_git_dir():
    with tempfile.TemporaryDirectory() as d:
        sig = ux.detect_from_diff(d, base="origin/main")
        assert sig.failed_open is True
        assert sig.is_ux_work is True


def test_detect_from_issue():
    ux_issue = _issue("Dashboard layout overflow on mobile", "The card is misaligned at 375px")
    assert ux.detect_from_issue(ux_issue).is_ux_work is True
    backend_issue = _issue("Optimize SQLite query in assessments route", "N+1 on findings join")
    assert ux.detect_from_issue(backend_issue).is_ux_work is False
    labeled = _issue("Tweak", "minor", labels=["ux"])
    assert ux.detect_from_issue(labeled).is_ux_work is True


def test_detect_merges_plan_declaration():
    sig = ux.detect(issue=_issue("backend only", "nothing visual"), plan_self_declared=True)
    assert sig.is_ux_work is True
    assert sig.plan_self_declared is True


def test_state_roundtrip_ux_fields():
    data = ADWStateData(adw_id="deadbeef", is_ux_work=True, ux_signal={"is_ux_work": True})
    assert data.is_ux_work is True
    assert data.ux_signal == {"is_ux_work": True}
    for f in ("is_ux_work", "ux_signal"):
        assert f in CORE_FIELDS, f"{f} not persisted by ADWState"


def test_model_map_covers_ux_commands():
    for cmd in ("/test_ux", "/resolve_failed_ux_test", "/ux_validate"):
        assert cmd in SLASH_COMMAND_MODEL_MAP, f"{cmd} missing from model map"


def main():
    tests = [
        test_is_ux_path,
        test_keyword_signal_requires_two_distinct,
        test_label_signal,
        test_screenshot_signal,
        test_combine_authoritative_diff_wins,
        test_combine_screenshot_alone_is_weak,
        test_fail_open_on_non_git_dir,
        test_detect_from_issue,
        test_detect_merges_plan_declaration,
        test_state_roundtrip_ux_fields,
        test_model_map_covers_ux_commands,
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
    print(f"\nAll {len(tests)} UX detection tests passed")


if __name__ == "__main__":
    main()
