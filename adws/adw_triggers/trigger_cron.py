#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""Cron-style ADW trigger: poll GitHub issues and launch an ADW pipeline.

An issue qualifies when it carries the label `adw:zte` / `adw:ship`, OR its
latest non-bot comment starts with `adw`. The label decides the mode:
- `adw:ship` → ship-only: ship the issue's EXISTING open PR (requires one).
- `adw:zte` (or the magic comment) → full pipeline (only when no PR is open yet).
`adw:ship` wins if both labels are present. Bot comments (tagged `[ADW-AGENTS]`)
never trigger (loop guard), and `adw:freeze` / ADW_DISABLED act as kill-switches.

State persists in adw_triggers/.cron_state.json (last-processed comment id per
issue) so restarts don't reprocess.

Usage:
  uv run adws/adw_triggers/trigger_cron.py [--interval SECONDS] [--once]
"""

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))

from adw_modules.utils import get_safe_subprocess_env, make_adw_id
from adw_modules.github import (
    fetch_open_issues,
    fetch_issue_comments,
    get_repo_url,
    extract_repo_path,
    ADW_BOT_IDENTIFIER,
)

load_dotenv()

ZTE_LABEL = "adw:zte"
SHIP_LABEL = "adw:ship"
FREEZE_LABEL = "adw:freeze"
STATE_FILE = Path(__file__).parent / ".cron_state.json"

shutdown_requested = False


def signal_handler(signum, frame):
    global shutdown_requested
    print(f"\nReceived signal {signum}; shutting down gracefully…")
    shutdown_requested = True


def load_cron_state() -> Dict[str, str]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def save_cron_state(state: Dict[str, str]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def has_open_adw_pr(repo_path: str, issue_number: int) -> bool:
    """True if an open PR already exists for this issue's ADW branch pattern."""
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", repo_path, "--state", "open",
         "--limit", "200", "--json", "headRefName"],
        capture_output=True,
        text=True,
        env=get_safe_subprocess_env(),
    )
    if result.returncode != 0:
        return False
    try:
        prs = json.loads(result.stdout)
    except json.JSONDecodeError:
        return False
    # Match the ADW branch convention (<class>-issue-<n>-adw-...), not any branch
    # that merely mentions the issue number, to avoid false positives on human PRs.
    return any(f"-issue-{issue_number}-adw-" in pr.get("headRefName", "") for pr in prs)


def qualifies(issue, repo_path: str, cron_state: Dict[str, str]) -> Tuple[Optional[str], Optional[str]]:
    """Return (mode, latest_comment_id) where mode ∈ {None, "zte", "ship"}."""
    labels = {label.name for label in issue.labels}
    if FREEZE_LABEL in labels:
        return None, None

    comments = fetch_issue_comments(repo_path, issue.number)
    latest = comments[-1] if comments else None
    latest_id = str(latest.get("id")) if latest else "none"
    latest_body = latest.get("body", "") if latest else ""

    # Loop guard: never trigger off a bot comment.
    if latest and ADW_BOT_IDENTIFIER in latest_body:
        return None, latest_id

    # Determine the mode. adw:ship (ship the existing PR) wins over the
    # full-pipeline triggers when both are present.
    if SHIP_LABEL in labels:
        mode = "ship"
    elif ZTE_LABEL in labels or latest_body.strip().lower().startswith("adw"):
        mode = "zte"
    else:
        return None, latest_id

    # De-dup: same comment id already processed.
    if cron_state.get(str(issue.number)) == latest_id:
        return None, latest_id

    pr_open = has_open_adw_pr(repo_path, issue.number)
    if mode == "ship":
        # Ship-only needs an existing PR — nothing to ship otherwise.
        if not pr_open:
            return None, latest_id
    else:
        # Don't start a second full run if a PR for this issue is already open.
        if pr_open:
            return None, latest_id

    return mode, latest_id


def launch(issue_number: int, mode: str) -> bool:
    run_zte = Path(__file__).parent / "run_zte.py"
    if mode == "ship":
        # Ship-only resolves the adw_id from the existing PR branch (no id passed).
        cmd = ["uv", "run", str(run_zte), str(issue_number), "--ship-only"]
    else:
        adw_id = make_adw_id()
        cmd = ["uv", "run", str(run_zte), str(issue_number), adw_id]
    print(f"Launching ADW ({mode}) for issue #{issue_number}: {' '.join(cmd)}")
    result = subprocess.run(cmd, env=get_safe_subprocess_env())
    return result.returncode == 0


def check_cycle(repo_path: str) -> None:
    if os.getenv("ADW_DISABLED", "").lower() == "true":
        print("ADW_DISABLED=true — skipping cycle")
        return
    cron_state = load_cron_state()
    try:
        issues = fetch_open_issues(repo_path)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR fetching issues: {e}")
        return

    for issue in issues:
        if shutdown_requested:
            break
        mode, latest_id = qualifies(issue, repo_path, cron_state)
        if latest_id is not None:
            # Record the latest comment id we've seen regardless, to avoid
            # re-evaluating the same state repeatedly.
            cron_state[str(issue.number)] = latest_id
        if mode:
            launch(issue.number, mode)
    save_cron_state(cron_state)


def main():
    interval = 60
    run_once = "--once" in sys.argv
    if run_once:
        sys.argv.remove("--once")
    if "--interval" in sys.argv:
        i = sys.argv.index("--interval")
        interval = int(sys.argv[i + 1])

    try:
        repo_path = extract_repo_path(get_repo_url())
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print(f"ADW cron trigger — repo {repo_path}, interval {interval}s")
    check_cycle(repo_path)
    if run_once:
        return
    while not shutdown_requested:
        for _ in range(interval):
            if shutdown_requested:
                break
            time.sleep(1)
        if not shutdown_requested:
            check_cycle(repo_path)
    print("Shutdown complete")


if __name__ == "__main__":
    main()
