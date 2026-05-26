#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""ADW PostToolUse hook: append the tool result to a per-session log."""

import json
import os
import sys
from pathlib import Path


def main():
    try:
        input_data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    try:
        root = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
        session = input_data.get("session_id", "unknown")
        log_dir = Path(root) / "agents" / "_hooks" / session
        log_dir.mkdir(parents=True, exist_ok=True)
        path = log_dir / "post_tool_use.json"
        data = json.loads(path.read_text()) if path.exists() else []
        data.append(input_data)
        path.write_text(json.dumps(data, indent=2))
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
