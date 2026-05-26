#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""Thin wrapper that launches the ZTE pipeline for one issue.

Used by the cron trigger and the GitHub Actions trigger so they have a single,
stable entry point. Forwards any extra flags to adw_sdlc_zte_iso.py.

Usage:
  uv run adws/adw_triggers/run_zte.py <issue-number> [adw-id] [flags...]
"""

import os
import sys
import subprocess


def main():
    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_triggers/run_zte.py <issue-number> [adw-id] [flags...]")
        sys.exit(1)

    adws_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    zte = os.path.join(adws_dir, "adw_sdlc_zte_iso.py")
    cmd = ["uv", "run", zte, *sys.argv[1:]]
    print(f"Launching ZTE: {' '.join(cmd)}")
    sys.exit(subprocess.run(cmd).returncode)


if __name__ == "__main__":
    main()
