#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW Plan+Build+Test (isolated). Usage: uv run adws/adw_plan_build_test_iso.py <issue> [adw-id] [--skip-e2e]"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from adw_modules.workflow_ops import ensure_adw_id
from adw_modules.orchestrate import run_pipeline


def main():
    skip_e2e = "--skip-e2e" in sys.argv
    if skip_e2e:
        sys.argv.remove("--skip-e2e")
    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_plan_build_test_iso.py <issue-number> [adw-id] [--skip-e2e]")
        sys.exit(1)
    issue_number = sys.argv[1]
    adw_id = ensure_adw_id(issue_number, sys.argv[2] if len(sys.argv) > 2 else None)
    sys.exit(
        run_pipeline(
            issue_number,
            adw_id,
            [
                ("adw_plan_iso.py", [], True),
                ("adw_build_iso.py", [], True),
                ("adw_test_iso.py", ["--skip-e2e"] if skip_e2e else [], False),
            ],
        )
    )


if __name__ == "__main__":
    main()
