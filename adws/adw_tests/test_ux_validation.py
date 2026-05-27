#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.7", "python-dotenv>=1.0", "requests>=2.32"]
# ///
"""Unit tests for UX validation parsing, comment formatting, and ship gating (spec 0012).

Run: `uv run adws/adw_tests/test_ux_validation.py`
"""

import os
import sys

ADWS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ADWS_DIR)

import logging  # noqa: E402

from adw_modules.data_types import UxValidationResult  # noqa: E402
from adw_modules.github import ADW_UX_MARKER, ux_marker_body  # noqa: E402
from adw_modules.ship_ops import DEFAULT_REQUIRED_CHECKS, UX_CHECK_NAME, required_checks  # noqa: E402
from adw_modules.ux_ops import format_ux_validation_comment, parse_ux_validation  # noqa: E402

_LOG = logging.getLogger("test")

_SAMPLE = """
```json
{
  "verdict": "NEEDS_FIXES",
  "summary": "The date input still overflows at 375px.",
  "findings": [
    {"description": "input exceeds card", "severity": "blocker", "evidence_path": "/a/02_after.png"},
    {"description": "minor spacing", "severity": "minor"}
  ],
  "evidence_paths": ["/a/01_before.png", "/a/02_after.png"],
  "acceptance_criteria_checked": ["no horizontal overflow at 375px: MISSING"]
}
```
"""


def test_parse_ux_validation():
    result = parse_ux_validation(_SAMPLE, _LOG)
    assert isinstance(result, UxValidationResult)
    assert result.verdict == "NEEDS_FIXES"
    assert len(result.findings) == 2
    assert len(result.blockers) == 1
    assert result.blockers[0].severity == "blocker"


def test_parse_ux_validation_bad_input():
    assert parse_ux_validation("not json at all", _LOG) is None


def test_format_comment():
    result = parse_ux_validation(_SAMPLE, _LOG)
    body = format_ux_validation_comment(result)
    assert "`NEEDS_FIXES`" in body
    assert "🚫" in body and "blocker" in body
    assert "Acceptance criteria checked" in body
    assert "2 evidence artifact(s)" in body


def test_format_comment_with_evidence_urls_before_after_pair():
    result = parse_ux_validation(_SAMPLE, _LOG)
    evidence_urls = [
        ("01_before_new-assessment_mobile.png", "https://example.com/before.png"),
        ("02_after_new-assessment_mobile.png", "https://example.com/after.png"),
    ]
    body = format_ux_validation_comment(result, evidence_urls=evidence_urls)
    assert "<details>" in body
    assert "📸 Evidence" in body
    assert "![before](https://example.com/before.png)" in body
    assert "![after](https://example.com/after.png)" in body
    assert "new-assessment mobile" in body
    assert "evidence artifact(s)" not in body


def test_format_comment_with_evidence_urls_singles():
    result = parse_ux_validation(_SAMPLE, _LOG)
    evidence_urls = [
        ("screenshot_dashboard.png", "https://example.com/dash.png"),
    ]
    body = format_ux_validation_comment(result, evidence_urls=evidence_urls)
    assert "<details>" in body
    assert "![screenshot_dashboard.png](https://example.com/dash.png)" in body
    assert "evidence artifact(s)" not in body


def test_format_comment_no_urls_fallback():
    result = parse_ux_validation(_SAMPLE, _LOG)
    body = format_ux_validation_comment(result, evidence_urls=None)
    assert "2 evidence artifact(s)" in body
    assert "<details>" not in body


def test_format_comment_empty_urls_fallback():
    result = parse_ux_validation(_SAMPLE, _LOG)
    body = format_ux_validation_comment(result, evidence_urls=[])
    assert "2 evidence artifact(s)" in body
    assert "<details>" not in body


def test_format_comment_singular_plural():
    result = parse_ux_validation(_SAMPLE, _LOG)
    one_url = [("01_before_foo.png", "https://example.com/a.png")]
    body_one = format_ux_validation_comment(result, evidence_urls=one_url)
    assert "1 screenshot)" in body_one
    assert "1 screenshots)" not in body_one

    three_urls = [
        ("01_before_foo.png", "https://example.com/a.png"),
        ("02_after_foo.png", "https://example.com/b.png"),
        ("screenshot_extra.png", "https://example.com/c.png"),
    ]
    body_three = format_ux_validation_comment(result, evidence_urls=three_urls)
    assert "3 screenshots)" in body_three


def test_ux_marker_body():
    body = ux_marker_body("abc123def", "PASS", "looks good")
    assert body.startswith(ADW_UX_MARKER)
    assert "sha:abc123def" in body
    assert "verdict:PASS" in body
    assert "`PASS`" in body
    assert "abc123de" in body  # short sha


def test_required_checks_gating():
    saved = os.environ.get("ADW_UX_GATE")
    saved_req = os.environ.get("ADW_REQUIRED_CHECKS")
    os.environ.pop("ADW_REQUIRED_CHECKS", None)
    try:
        os.environ.pop("ADW_UX_GATE", None)  # default = block
        assert UX_CHECK_NAME in required_checks(is_ux_work=True)
        assert UX_CHECK_NAME not in required_checks(is_ux_work=False)
        assert required_checks(is_ux_work=False) == DEFAULT_REQUIRED_CHECKS

        os.environ["ADW_UX_GATE"] = "advisory"
        assert UX_CHECK_NAME not in required_checks(is_ux_work=True)
    finally:
        if saved is None:
            os.environ.pop("ADW_UX_GATE", None)
        else:
            os.environ["ADW_UX_GATE"] = saved
        if saved_req is not None:
            os.environ["ADW_REQUIRED_CHECKS"] = saved_req


def main():
    tests = [
        test_parse_ux_validation,
        test_parse_ux_validation_bad_input,
        test_format_comment,
        test_format_comment_with_evidence_urls_before_after_pair,
        test_format_comment_with_evidence_urls_singles,
        test_format_comment_no_urls_fallback,
        test_format_comment_empty_urls_fallback,
        test_format_comment_singular_plural,
        test_ux_marker_body,
        test_required_checks_gating,
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
    print(f"\nAll {len(tests)} UX validation tests passed")


if __name__ == "__main__":
    main()
