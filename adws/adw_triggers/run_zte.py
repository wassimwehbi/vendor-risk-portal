#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""Thin wrapper that launches the ZTE pipeline for one issue.

Used by the cron trigger and the GitHub Actions trigger so they have a single,
stable entry point. Routes on `--ship-only`: with it, runs the ship-only
pipeline (adw_ship_zte.py); otherwise the full pipeline (adw_sdlc_zte.py). Any
other flags are forwarded to the target.

Usage:
  uv run adws/adw_triggers/run_zte.py <issue-number> [adw-id] [--ship-only] [flags...]
"""

import os
import sys
import subprocess


def main():
    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_triggers/run_zte.py <issue-number> [adw-id] [--ship-only] [flags...]")
        sys.exit(1)

    args = sys.argv[1:]
    adws_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    if "--ship-only" in args:
        args = [a for a in args if a != "--ship-only"]
        target = os.path.join(adws_dir, "adw_ship_zte.py")
    else:
        target = os.path.join(adws_dir, "adw_sdlc_zte.py")

    cmd = ["uv", "run", target, *args]
    print(f"Launching: {' '.join(cmd)}")
    sys.exit(subprocess.run(cmd).returncode)


if __name__ == "__main__":
    main()
