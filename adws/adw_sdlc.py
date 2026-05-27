#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv>=1.0", "pydantic>=2.7", "requests>=2.32"]
# ///
"""ADW SDLC (isolated) — plan → build → test → review → ux → document (no ship).

Usage: uv run adws/adw_sdlc.py <issue-number> [adw-id] [--skip-e2e] [--skip-ux]
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from adw_modules.workflow_ops import ensure_adw_id
from adw_modules.orchestrate import run_pipeline


def main():
    skip_e2e = "--skip-e2e" in sys.argv
    skip_ux = "--skip-ux" in sys.argv
    for f in ("--skip-e2e", "--skip-ux"):
        if f in sys.argv:
            sys.argv.remove(f)

    if len(sys.argv) < 2:
        print("Usage: uv run adws/adw_sdlc.py <issue-number> [adw-id] [--skip-e2e] [--skip-ux]")
        sys.exit(1)

    issue_number = sys.argv[1]
    adw_id = ensure_adw_id(issue_number, sys.argv[2] if len(sys.argv) > 2 else None)
    print(f"Using ADW ID: {adw_id}")

    test_args = ["--skip-e2e"] if skip_e2e else []
    phases = [
        ("adw_plan.py", [], True),
        ("adw_build.py", [], True),
        ("adw_test.py", test_args, False),
        ("adw_review.py", [], False),
    ]
    if not skip_ux:
        phases.append(("adw_ux_validation.py", [], False))
    phases.append(("adw_document.py", [], False))
    rc = run_pipeline(issue_number, adw_id, phases)
    if rc == 0:
        print(f"\n=== SDLC COMPLETE === ADW ID: {adw_id}")
    sys.exit(rc)


if __name__ == "__main__":
    main()
