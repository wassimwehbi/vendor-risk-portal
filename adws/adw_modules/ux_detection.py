"""UX-work detection for ADW (spec 0012).

Robust, layered, and FAIL-OPEN detection of whether a unit of work is UX/UI-related —
for *all* work types (feature/bug/chore/patch), not just bugs. Three signals are OR-ed:

  1. Authoritative — the git diff touches UX-bearing paths (``client/src/**`` etc.).
     This keys on what actually changed, so it works regardless of issue classification.
  2. Heuristic — issue title/body keywords (≥2 distinct), a UX label, or an embedded
     screenshot. Available at plan time, before any code exists.
  3. LLM — the plan-spec's own UX-impact declaration.

Any error obtaining the diff or evaluating a signal sets ``failed_open`` and forces the
result to UX (cheaper to run an extra advisory phase than to silently ship a broken UI).

Pure and dependency-light (stdlib + the ADW data types) so it is trivially unit-testable.
"""

import fnmatch
import os
import re
import subprocess
from typing import Iterable, List, Optional, Tuple

from adw_modules.data_types import GitHubIssue, UxSignal

# ── Path signal (authoritative) ─────────────────────────────────────────────
# UX-bearing source paths (repo-relative, forward-slash). Touching any of these means a
# user-visible change. Kept broad on purpose (fail toward running the UX validation).
UX_PATH_PREFIXES: Tuple[str, ...] = (
    "client/src/pages/",
    "client/src/components/",
    "client/src/",  # hooks/context/styles that affect render
    "e2e/ux/",  # the UX scenario manifest/harness itself
)
UX_PATH_EXACT: Tuple[str, ...] = ("client/src/index.css",)
UX_PATH_GLOBS: Tuple[str, ...] = (
    "client/tailwind.config.*",
    "client/postcss.config.*",
)
# Paths under the prefixes that are NOT UX — exclude to cut false positives.
UX_PATH_EXCLUDE_SUFFIXES: Tuple[str, ...] = (
    ".test.ts",
    ".test.tsx",
    ".spec.ts",
    ".spec.tsx",
    ".d.ts",
)

# ── Heuristic signals (issue text) ──────────────────────────────────────────
UX_KEYWORD_THRESHOLD = 2
UX_KEYWORDS: Tuple[str, ...] = (
    "ux", "ui", "visual", "design", "layout", "styling", "css", "tailwind",
    "responsive", "mobile", "viewport", "alignment", "spacing", "color", "colour",
    "theme", "dark mode", "accessibility", "a11y", "screen reader", "aria",
    "contrast", "button", "modal", "dropdown", "navbar", "sidebar", "tooltip",
    "overflow", "scroll", "truncate", "render", "screenshot", "focus", "hover",
)
UX_LABELS = frozenset({"ux", "ui", "visual", "design", "accessibility", "a11y"})
_SCREENSHOT_RE = re.compile(
    r"!\[[^\]]*\]\([^)]+\)"  # markdown image
    r"|https?://\S+\.(?:png|jpe?g|gif|webp)\b"  # bare image URL
    r"|user-images\.githubusercontent\.com"  # legacy GH attachment host
    r"|github\.com/user-attachments",  # current GH attachment host
    re.IGNORECASE,
)

# Base ref for the authoritative diff (env-overridable for forks / odd CI checkouts).
UX_DIFF_BASE = os.getenv("ADW_UX_DIFF_BASE", "origin/main")


def _normalize(path: str) -> str:
    return path.strip().lstrip("./")


def is_ux_path(path: str) -> bool:
    """True iff a single changed file path is UX-bearing."""
    p = _normalize(path)
    if not p or any(p.endswith(s) for s in UX_PATH_EXCLUDE_SUFFIXES):
        return False
    if p in UX_PATH_EXACT:
        return True
    if any(p.startswith(prefix) for prefix in UX_PATH_PREFIXES):
        return True
    return any(fnmatch.fnmatch(p, g) for g in UX_PATH_GLOBS)


def _changed_files(working_dir: str, base: str) -> Tuple[List[str], bool]:
    """Best-effort changed-file list. Returns (files, failed_open).

    Tries merge-base (three-dot) against ``base``, then two-dot, then HEAD~1. Any error
    or all-attempts-failing → ([], True)."""
    for spec in (f"{base}...HEAD", f"{base}..HEAD", "HEAD~1"):
        try:
            res = subprocess.run(
                ["git", "diff", "--name-only", spec],
                cwd=working_dir,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except Exception:  # noqa: BLE001 - any git failure → fail open
            continue
        if res.returncode == 0:
            return [ln.strip() for ln in res.stdout.splitlines() if ln.strip()], False
    return [], True


def diff_ux_paths(working_dir: str, base: str = UX_DIFF_BASE) -> Tuple[List[str], bool]:
    """Authoritative signal: UX-bearing paths in the diff. Returns (ux_paths, failed_open)."""
    files, failed = _changed_files(working_dir, base)
    if failed:
        return [], True
    return [f for f in files if is_ux_path(f)], False


def keyword_signal(title: str, body: str) -> List[str]:
    """Distinct UX keywords matched word-boundary, case-insensitive, across title+body."""
    text = f"{title or ''}\n{body or ''}".lower()
    hits: List[str] = []
    for kw in UX_KEYWORDS:
        if re.search(r"\b" + re.escape(kw) + r"\b", text) and kw not in hits:
            hits.append(kw)
    return hits


def label_signal(labels: Iterable[str]) -> List[str]:
    """Lowercased label names intersecting UX_LABELS."""
    return sorted({(name or "").lower() for name in labels} & UX_LABELS)


def screenshot_signal(body: str) -> bool:
    """True if the issue body embeds an image/screenshot attachment."""
    return bool(_SCREENSHOT_RE.search(body or ""))


def _combined_is_ux(sig: UxSignal) -> bool:
    """The OR-ed decision. Screenshot alone is weak — it needs a keyword/label too."""
    if sig.failed_open:
        return True
    if sig.diff_paths_hit:
        return True
    if len(sig.keyword_hits) >= UX_KEYWORD_THRESHOLD:
        return True
    if sig.label_hits:
        return True
    if sig.has_screenshots and (sig.keyword_hits or sig.label_hits):
        return True
    return bool(sig.plan_self_declared)


def detect_from_issue(issue: GitHubIssue) -> UxSignal:
    """Plan-time detection on issue TEXT only (no diff yet)."""
    sig = UxSignal(
        keyword_hits=keyword_signal(issue.title, issue.body),
        label_hits=label_signal(label.name for label in issue.labels),
        has_screenshots=screenshot_signal(issue.body),
    )
    sig.is_ux_work = _combined_is_ux(sig)
    return sig


def detect_from_diff(working_dir: str, base: str = UX_DIFF_BASE) -> UxSignal:
    """Build/PR-time AUTHORITATIVE detection on the diff."""
    paths, failed = diff_ux_paths(working_dir, base)
    sig = UxSignal(diff_paths_hit=paths, failed_open=failed)
    sig.is_ux_work = _combined_is_ux(sig)
    return sig


def combine(*signals: UxSignal, plan_self_declared: Optional[bool] = None) -> UxSignal:
    """Merge signals (union of hits); recompute the decision. failed_open propagates."""
    merged = UxSignal()
    for s in signals:
        merged.diff_paths_hit = sorted(set(merged.diff_paths_hit) | set(s.diff_paths_hit))
        merged.keyword_hits = sorted(set(merged.keyword_hits) | set(s.keyword_hits))
        merged.label_hits = sorted(set(merged.label_hits) | set(s.label_hits))
        merged.has_screenshots = merged.has_screenshots or s.has_screenshots
        merged.failed_open = merged.failed_open or s.failed_open
        if s.plan_self_declared is not None:
            merged.plan_self_declared = s.plan_self_declared
    if plan_self_declared is not None:
        merged.plan_self_declared = plan_self_declared
    merged.is_ux_work = _combined_is_ux(merged)
    return merged


def detect(
    issue: Optional[GitHubIssue] = None,
    working_dir: Optional[str] = None,
    plan_self_declared: Optional[bool] = None,
    base: str = UX_DIFF_BASE,
) -> UxSignal:
    """Top-level convenience: run text + diff detection (each guarded → fail open), merge."""
    signals: List[UxSignal] = []
    if issue is not None:
        try:
            signals.append(detect_from_issue(issue))
        except Exception:  # noqa: BLE001
            signals.append(UxSignal(failed_open=True))
    if working_dir is not None:
        try:
            signals.append(detect_from_diff(working_dir, base))
        except Exception:  # noqa: BLE001
            signals.append(UxSignal(failed_open=True))
    return combine(*signals, plan_self_declared=plan_self_declared)


def record_to_state(state, signal: UxSignal) -> None:
    """Persist is_ux_work + the ux_signal dict into ADW state and save."""
    state.update(is_ux_work=signal.is_ux_work, ux_signal=signal.model_dump())
    state.save("ux_detection")
