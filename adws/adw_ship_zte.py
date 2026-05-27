#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Ship ZTE (isolated) — ship-only Zero-Touch Engineering.

Given an issue that already has an open ADW PR, skip plan→build→test→review→
document and run only the ship phase on that PR: wait for the required checks
(auto-fixing quality/e2e), resolve Copilot feedback, then squash-merge.

Triggered by the `adw:ship` label (cron poller / GitHub Actions), or directly:
  uv run adws/adw_ship_zte.py <issue-number>
    [--dry-run] [--admin] [--no-copilot] [--max-ship-iters N] [--checks-timeout MIN]

The adw_id is recovered from the existing PR's branch, so no adw-id is passed.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

from adw_modules.workflow_ops import bootstrap_ship_only_state
from adw_modules.orchestrate import run_pipeline
from adw_modules.utils import setup_logger
from adw_modules.phase import post


def _pop_int_flag(name, default):
    if name in sys.argv:
        i = sys.argv.index(name)
        try:
            val = sys.argv[i + 1]
            int(val)
        except (IndexError, ValueError):
            print(f"Error: {name} requires an integer value")
            sys.exit(1)
        del sys.argv[i : i + 2]
        return val
    return default


def main():
    load_dotenv()

    if os.getenv("ADW_DISABLED", "").lower() == "true":
        print("ADW_DISABLED=true — ship-only disabled; exiting.")
        sys.exit(0)

    dry_run = "--dry-run" in sys.argv
    admin = "--admin" in sys.argv
    no_copilot = "--no-copilot" in sys.argv
    max_ship_iters = _pop_int_flag("--max-ship-iters", None)
    checks_timeout = _pop_int_flag("--checks-timeout", None)
    for f in ("--dry-run", "--admin", "--no-copilot"):
        if f in sys.argv:
            sys.argv.remove(f)

    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_ship_zte.py <issue-number> [flags]")
        sys.exit(1)

    issue_number = sys.argv[1]
    logger = setup_logger("ship-only", "adw_ship_zte")  # temp until adw_id is recovered

    adw_id, _state, error = bootstrap_ship_only_state(issue_number, logger)
    if error:
        logger.error(f"Ship-only bootstrap failed: {error}")
        post(issue_number, adw_id or "ship-only", "shipper",
             f"🛑 Needs human attention: {error}")
        sys.exit(1)

    # Re-bind the logger to the recovered id so logs sit with the run's state.
    logger = setup_logger(adw_id, "adw_ship_zte")
    logger.info(f"Using ADW ID: {adw_id}")
    print(f"Using ADW ID: {adw_id}")

    ship_args = []
    if dry_run:
        ship_args.append("--dry-run")
    if admin:
        ship_args.append("--admin")
    if no_copilot:
        ship_args.append("--no-copilot")
    if max_ship_iters:
        ship_args += ["--max-ship-iters", max_ship_iters]
    if checks_timeout:
        ship_args += ["--checks-timeout", checks_timeout]

    phases = [("adw_ship.py", ship_args, True)]
    rc = run_pipeline(issue_number, adw_id, phases)
    if rc == 0:
        print(f"\n=== SHIP-ONLY COMPLETE === ADW ID: {adw_id}")
    sys.exit(rc)


if __name__ == "__main__":
    main()
