#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.7", "python-dotenv>=1.0", "requests>=2.32"]
# ///
"""Unit tests for the branch-sync git plumbing (spec 0013).

Exercises git_ops' merge/conflict helpers against throwaway local repos (no network,
no agent). Run: `uv run adws/adw_tests/test_merge_ops.py`
"""

import os
import subprocess
import sys
import tempfile

ADWS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ADWS_DIR)

from adw_modules import git_ops  # noqa: E402
from adw_modules.agent import SLASH_COMMAND_MODEL_MAP  # noqa: E402


def _git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def _write(cwd, name, content):
    with open(os.path.join(cwd, name), "w", encoding="utf-8") as f:
        f.write(content)


def _write_bytes(cwd, name, content: bytes):
    with open(os.path.join(cwd, name), "wb") as f:
        f.write(content)


def _init_repo(cwd):
    _git(cwd, "init", "-b", "main")
    _git(cwd, "config", "user.email", "t@example.test")
    _git(cwd, "config", "user.name", "Test")
    _write(cwd, "file.txt", "line1\nline2\nline3\n")
    _git(cwd, "add", "-A")
    _git(cwd, "commit", "-m", "init")


def _diverge(cwd, feat_line2, main_line2=None, main_only_file=None):
    """Branch `feat` off main, change line2 to feat_line2; then advance main."""
    _git(cwd, "checkout", "-b", "feat")
    _write(cwd, "file.txt", f"line1\n{feat_line2}\nline3\n")
    _git(cwd, "commit", "-am", "feat change")
    _git(cwd, "checkout", "main")
    if main_line2 is not None:
        _write(cwd, "file.txt", f"line1\n{main_line2}\nline3\n")
        _git(cwd, "commit", "-am", "main change")
    if main_only_file:
        _write(cwd, main_only_file, "main only\n")
        _git(cwd, "add", "-A")
        _git(cwd, "commit", "-m", "main adds file")
    _git(cwd, "checkout", "feat")


def test_up_to_date():
    with tempfile.TemporaryDirectory() as d:
        _init_repo(d)
        _git(d, "checkout", "-b", "feat")
        assert git_ops.is_up_to_date_with("main", cwd=d) is True


def test_clean_merge():
    with tempfile.TemporaryDirectory() as d:
        _init_repo(d)
        # feat edits line2; main adds an unrelated file → no overlap.
        _diverge(d, feat_line2="FEAT", main_only_file="other.txt")
        assert git_ops.is_up_to_date_with("main", cwd=d) is False
        status, conflicts = git_ops.merge_base_into_head("main", cwd=d)
        assert status == "merged", (status, conflicts)
        assert conflicts == []
        assert git_ops.is_up_to_date_with("main", cwd=d) is True


def test_conflict_detect_and_abort():
    with tempfile.TemporaryDirectory() as d:
        _init_repo(d)
        _diverge(d, feat_line2="FEAT", main_line2="MAIN")  # same line → conflict
        status, conflicts = git_ops.merge_base_into_head("main", cwd=d)
        assert status == "conflicted", (status, conflicts)
        assert conflicts == ["file.txt"], conflicts
        assert git_ops.has_conflict_markers(["file.txt"], cwd=d) is True
        git_ops.abort_merge(cwd=d)
        assert git_ops.has_conflict_markers(["file.txt"], cwd=d) is False


def test_resolve_then_complete():
    with tempfile.TemporaryDirectory() as d:
        _init_repo(d)
        _diverge(d, feat_line2="FEAT", main_line2="MAIN")
        status, _ = git_ops.merge_base_into_head("main", cwd=d)
        assert status == "conflicted"
        # Simulate the /resolve_conflicts agent keeping both intents.
        _write(d, "file.txt", "line1\nFEAT+MAIN\nline3\n")
        assert git_ops.has_conflict_markers(["file.txt"], cwd=d) is False
        ok, err = git_ops.complete_merge(cwd=d)
        assert ok, err
        # The merge commit now has main as an ancestor.
        assert git_ops.is_up_to_date_with("main", cwd=d) is True


def test_is_binary_path():
    with tempfile.TemporaryDirectory() as d:
        _write_bytes(d, "img.bin", b"\x89PNG\x00\x00data")
        _write(d, "text.txt", "plain text\n")
        assert git_ops.is_binary_path("img.bin", cwd=d) is True
        assert git_ops.is_binary_path("text.txt", cwd=d) is False
        assert git_ops.is_binary_path("missing.bin", cwd=d) is False


def test_binary_conflict_resolved_in_favor_of_main():
    """A binary baseline changed on both sides: the text agent is bypassed and main wins."""
    with tempfile.TemporaryDirectory() as d:
        _init_repo(d)
        _write_bytes(d, "shot.png", b"\x89PNG\x00ORIGINAL\x00")
        _git(d, "add", "-A")
        _git(d, "commit", "-m", "add baseline")
        main_bytes = b"\x89PNG\x00MAIN-BASELINE\x00"

        _git(d, "checkout", "-b", "feat")
        _write_bytes(d, "shot.png", b"\x89PNG\x00FEAT-VERSION\x00")
        _git(d, "commit", "-am", "feat changes baseline")
        _git(d, "checkout", "main")
        _write_bytes(d, "shot.png", main_bytes)
        _git(d, "commit", "-am", "main changes baseline")
        _git(d, "checkout", "feat")

        status, conflicts = git_ops.merge_base_into_head("main", cwd=d)
        assert status == "conflicted", (status, conflicts)
        assert conflicts == ["shot.png"], conflicts
        assert git_ops.is_binary_path("shot.png", cwd=d) is True
        # A binary conflict carries no text markers — the marker check is blind to it.
        assert git_ops.has_conflict_markers(["shot.png"], cwd=d) is False

        ok, err = git_ops.resolve_take_theirs(["shot.png"], cwd=d)
        assert ok, err
        with open(os.path.join(d, "shot.png"), "rb") as fh:
            assert fh.read() == main_bytes  # took main's version

        ok, err = git_ops.complete_merge(cwd=d)
        assert ok, err
        assert git_ops.is_up_to_date_with("main", cwd=d) is True


def test_resolve_conflicts_in_model_map():
    assert "/resolve_conflicts" in SLASH_COMMAND_MODEL_MAP


def main():
    tests = [
        test_up_to_date,
        test_clean_merge,
        test_conflict_detect_and_abort,
        test_resolve_then_complete,
        test_is_binary_path,
        test_binary_conflict_resolved_in_favor_of_main,
        test_resolve_conflicts_in_model_map,
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
    print(f"\nAll {len(tests)} branch-sync tests passed")


if __name__ == "__main__":
    main()
