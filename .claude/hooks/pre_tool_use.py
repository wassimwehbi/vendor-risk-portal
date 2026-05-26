#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""ADW PreToolUse hook: block destructive/sensitive actions, then log.

This is the real safety net for ADW runs because the agent executes with
--dangerously-skip-permissions (which bypasses settings allow/deny but NOT
hooks). Exit code 2 blocks the tool call and surfaces the message to the agent.

Activated only for ADW-spawned sessions (registered via adws/adw_settings.json,
passed with `claude --settings`), so interactive sessions are unaffected.
"""

import json
import os
import re
import sys
from pathlib import Path


def is_dangerous_rm(command: str) -> bool:
    normalized = " ".join(command.lower().split())
    patterns = [
        r"\brm\s+.*-[a-z]*r[a-z]*f",
        r"\brm\s+.*-[a-z]*f[a-z]*r",
        r"\brm\s+--recursive\s+--force",
        r"\brm\s+--force\s+--recursive",
    ]
    if any(re.search(p, normalized) for p in patterns):
        # Allow scoped removals inside the workspace; block obviously dangerous targets.
        dangerous_targets = [r"\s/\s", r"\s/$", r"\s~/?", r"\s\$home", r"\s\*", r"\s\.\.", r"\s/\*"]
        if any(re.search(t, normalized) for t in dangerous_targets):
            return True
        # rm -rf with no path or root-ish path
        if re.search(r"\brm\s+-[a-z]*r[a-z]*f?\s*$", normalized):
            return True
    return False


def is_force_push_to_protected(command: str) -> bool:
    n = " ".join(command.lower().split())
    if re.search(r"\bgit\s+push\b", n) and re.search(r"(--force\b|-f\b|--force-with-lease)", n):
        if re.search(r"\b(main|master)\b", n) or "origin main" in n:
            return True
    return False


def is_env_file_access(tool_name: str, tool_input: dict) -> bool:
    if tool_name in ("Read", "Edit", "MultiEdit", "Write"):
        fp = tool_input.get("file_path", "")
        return ".env" in fp and not fp.endswith(".env.sample") and not fp.endswith(".env.example")
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        return bool(re.search(r"\b\.env\b(?!\.(sample|example))", cmd))
    return False


def log(input_data: dict) -> None:
    try:
        root = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
        session = input_data.get("session_id", "unknown")
        log_dir = Path(root) / "agents" / "_hooks" / session
        log_dir.mkdir(parents=True, exist_ok=True)
        path = log_dir / "pre_tool_use.json"
        data = json.loads(path.read_text()) if path.exists() else []
        data.append(input_data)
        path.write_text(json.dumps(data, indent=2))
    except Exception:
        pass


def main():
    try:
        input_data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    if is_env_file_access(tool_name, tool_input):
        print("BLOCKED: access to .env secrets is prohibited (use .env.sample).", file=sys.stderr)
        sys.exit(2)

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if is_dangerous_rm(command):
            print("BLOCKED: dangerous rm command detected.", file=sys.stderr)
            sys.exit(2)
        if is_force_push_to_protected(command):
            print("BLOCKED: force-push to a protected branch is prohibited.", file=sys.stderr)
            sys.exit(2)

    log(input_data)
    sys.exit(0)


if __name__ == "__main__":
    main()
