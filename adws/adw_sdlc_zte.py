#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW SDLC ZTE (isolated) — Zero-Touch Engineering: the full pipeline.

plan → build → test → review → document → ship (PR + Copilot iteration + auto-merge).

Usage:
  uv run adws/adw_sdlc_zte.py <issue-number> [adw-id]
    [--skip-e2e] [--dry-run] [--admin] [--no-copilot] [--max-ship-iters N]

--dry-run runs the entire pipeline but stops before the final merge.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from adw_modules.workflow_ops import ensure_adw_id
from adw_modules.orchestrate import run_pipeline


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
    if os.getenv("ADW_DISABLED", "").lower() == "true":
        print("ADW_DISABLED=true — ZTE pipeline disabled; exiting.")
        sys.exit(0)

    skip_e2e = "--skip-e2e" in sys.argv
    dry_run = "--dry-run" in sys.argv
    admin = "--admin" in sys.argv
    no_copilot = "--no-copilot" in sys.argv
    max_ship_iters = _pop_int_flag("--max-ship-iters", None)
    for f in ("--skip-e2e", "--dry-run", "--admin", "--no-copilot"):
        if f in sys.argv:
            sys.argv.remove(f)

    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_sdlc_zte.py <issue-number> [adw-id] [flags]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = ensure_adw_id(issue_number, sys.argv[2] if len(sys.argv) > 2 else None)
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

    test_args = ["--skip-e2e"] if skip_e2e else []

    phases = [
        ("adw_plan.py", [], True),
        ("adw_build.py", [], True),
        ("adw_test.py", test_args, False),
        ("adw_review.py", [], False),
        ("adw_document.py", [], False),
        ("adw_ship.py", ship_args, True),
    ]
    rc = run_pipeline(issue_number, adw_id, phases)
    if rc == 0:
        print(f"\n=== ZTE PIPELINE COMPLETE === ADW ID: {adw_id}")
    sys.exit(rc)


if __name__ == "__main__":
    main()
