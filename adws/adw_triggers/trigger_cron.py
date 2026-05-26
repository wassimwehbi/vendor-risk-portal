#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""Cron-style ADW trigger: poll GitHub issues and launch the ZTE pipeline.

An issue qualifies when EITHER it carries the label `adw:zte` / `adw:ship`, OR
its latest non-bot comment starts with `adw`. Bot comments (tagged
`[ADW-AGENTS]`) never trigger (loop guard), and `adw:freeze` / ADW_DISABLED act
as kill-switches.

State persists in adw_triggers/.cron_state.json (last-processed comment id per
issue) so restarts don't reprocess, and an existing open ADW PR for the issue is
skipped.

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

TRIGGER_LABELS = {"adw:zte", "adw:ship"}
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


def qualifies(issue, repo_path: str, cron_state: Dict[str, str]) -> Tuple[bool, Optional[str]]:
    """Return (should_process, latest_comment_id)."""
    labels = {label.name for label in issue.labels}
    if FREEZE_LABEL in labels:
        return False, None

    comments = fetch_issue_comments(repo_path, issue.number)
    latest = comments[-1] if comments else None
    latest_id = str(latest.get("id")) if latest else "none"
    latest_body = latest.get("body", "") if latest else ""

    # Loop guard: never trigger off a bot comment.
    if latest and ADW_BOT_IDENTIFIER in latest_body:
        return False, latest_id

    triggered = bool(TRIGGER_LABELS & labels) or latest_body.strip().lower().startswith("adw")
    if not triggered:
        return False, latest_id

    # De-dup: same comment id already processed.
    if cron_state.get(str(issue.number)) == latest_id:
        return False, latest_id

    # Don't start a second run if a PR for this issue is already open.
    if has_open_adw_pr(repo_path, issue.number):
        return False, latest_id

    return True, latest_id


def launch(issue_number: int) -> bool:
    adw_id = make_adw_id()
    run_zte = Path(__file__).parent / "run_zte.py"
    cmd = ["uv", "run", str(run_zte), str(issue_number), adw_id]
    print(f"Launching ZTE for issue #{issue_number} (adw_id={adw_id})")
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
        should, latest_id = qualifies(issue, repo_path, cron_state)
        if latest_id is not None:
            # Record the latest comment id we've seen regardless, to avoid
            # re-evaluating the same state repeatedly.
            cron_state[str(issue.number)] = latest_id
        if should:
            launch(issue.number)
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
