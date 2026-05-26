"""Pipeline runner that chains ADW phase scripts via subprocess.

Each phase shares state through agents/<adw_id>/adw_state.json, so the
orchestrator only needs to pass (issue_number, adw_id) and any flags.
"""

import os
import subprocess
from typing import List, Tuple


def _script_path(script: str) -> str:
    # __file__ is adws/adw_modules/orchestrate.py → adws/<script>
    adws_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(adws_dir, script)


def run_phase(script: str, issue_number: str, adw_id: str, extra_args: List[str] = None) -> int:
    cmd = ["uv", "run", _script_path(script), issue_number, adw_id, *(extra_args or [])]
    print(f"\n=== {script} ===\nRunning: {' '.join(cmd)}")
    return subprocess.run(cmd).returncode


def run_pipeline(issue_number: str, adw_id: str, phases: List[Tuple[str, List[str], bool]]) -> int:
    """Run phases in order.

    phases: list of (script, extra_args, fatal). A non-zero exit from a fatal
    phase aborts the pipeline; a non-fatal phase only warns and continues.
    """
    for script, extra_args, fatal in phases:
        rc = run_phase(script, issue_number, adw_id, extra_args)
        if rc != 0:
            if fatal:
                print(f"{script} failed (rc={rc}); aborting pipeline")
                return rc
            print(f"WARNING: {script} failed (rc={rc}); continuing")
    return 0
