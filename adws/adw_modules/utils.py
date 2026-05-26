"""Utility functions for the ADW system."""

import json
import logging
import os
import re
import sys
import uuid
from typing import Any, TypeVar, Type, Union, Dict, Optional

T = TypeVar("T")


def make_adw_id() -> str:
    """Generate a short 8-character UUID for ADW tracking."""
    return str(uuid.uuid4())[:8]


def setup_logger(adw_id: str, trigger_type: str = "adw") -> logging.Logger:
    """Set up a logger that writes to both console and a per-ADW file.

    Args:
        adw_id: The ADW workflow ID
        trigger_type: Subdirectory under agents/{adw_id}/ for the log file

    Returns:
        Configured logger instance
    """
    # __file__ is in adws/adw_modules/, so go up 3 levels to reach the repo root.
    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    log_dir = os.path.join(project_root, "agents", adw_id, trigger_type)
    os.makedirs(log_dir, exist_ok=True)

    log_file = os.path.join(log_dir, "execution.log")

    logger = logging.getLogger(f"adw_{adw_id}")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    file_handler = logging.FileHandler(log_file, mode="a")
    file_handler.setLevel(logging.DEBUG)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)

    file_formatter = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    console_formatter = logging.Formatter("%(message)s")

    file_handler.setFormatter(file_formatter)
    console_handler.setFormatter(console_formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    logger.info(f"ADW Logger initialized - ID: {adw_id}")
    logger.debug(f"Log file: {log_file}")

    return logger


def get_logger(adw_id: str) -> logging.Logger:
    """Get an existing logger by ADW ID."""
    return logging.getLogger(f"adw_{adw_id}")


def parse_json(text: str, target_type: Type[T] = None) -> Union[T, Any]:
    """Parse JSON that may be wrapped in markdown code blocks.

    Handles raw JSON, ```json fenced blocks, ``` fenced blocks, and JSON with
    surrounding prose. Optionally validates into a Pydantic ``target_type`` (or
    ``List[Model]``).

    Raises:
        ValueError: If JSON cannot be parsed from the text.
    """
    code_block_pattern = r"```(?:json)?\s*\n(.*?)\n```"
    match = re.search(code_block_pattern, text, re.DOTALL)

    if match:
        json_str = match.group(1).strip()
    else:
        json_str = text.strip()

    if not (json_str.startswith("[") or json_str.startswith("{")):
        array_start = json_str.find("[")
        array_end = json_str.rfind("]")
        obj_start = json_str.find("{")
        obj_end = json_str.rfind("}")

        if array_start != -1 and (obj_start == -1 or array_start < obj_start):
            if array_end != -1:
                json_str = json_str[array_start : array_end + 1]
        elif obj_start != -1:
            if obj_end != -1:
                json_str = json_str[obj_start : obj_end + 1]

    try:
        result = json.loads(json_str)

        if target_type and hasattr(target_type, "__origin__"):
            if target_type.__origin__ == list:
                item_type = target_type.__args__[0]
                if hasattr(item_type, "model_validate"):
                    result = [item_type.model_validate(item) for item in result]
                elif hasattr(item_type, "parse_obj"):
                    result = [item_type.parse_obj(item) for item in result]
        elif target_type:
            if hasattr(target_type, "model_validate"):
                result = target_type.model_validate(result)
            elif hasattr(target_type, "parse_obj"):
                result = target_type.parse_obj(result)

        return result
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse JSON: {e}. Text was: {json_str[:200]}...")


def has_claude_credential() -> bool:
    """True if a Claude Code credential is configured via environment.

    Either a subscription OAuth token (``CLAUDE_CODE_OAUTH_TOKEN``, minted with
    ``claude setup-token``) or an API key (``ANTHROPIC_API_KEY``).
    """
    return bool(os.getenv("CLAUDE_CODE_OAUTH_TOKEN") or os.getenv("ANTHROPIC_API_KEY"))


def check_env_vars(logger: Optional[logging.Logger] = None) -> None:
    """Verify the environment can drive the Claude Code CLI and GitHub.

    Unlike tac-8 (which hard-required ``ANTHROPIC_API_KEY``), the Vendor Risk
    Portal layer authenticates the ``claude`` CLI via the user's *subscription*.
    Locally the CLI uses the existing interactive login automatically; in CI a
    long-lived ``CLAUDE_CODE_OAUTH_TOKEN`` is provided. So we only *warn* when no
    credential env var is set (the CLI may still be logged in), and never block.
    """
    def emit(level: str, msg: str) -> None:
        if logger:
            getattr(logger, level)(msg)
        else:
            print(msg, file=sys.stderr)

    if not has_claude_credential():
        emit(
            "warning",
            "No CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set. Relying on an "
            "existing interactive `claude` login. For CI, run `claude setup-token` "
            "locally and set CLAUDE_CODE_OAUTH_TOKEN as a secret (it is long-lived "
            "but may need periodic rotation).",
        )


# Environment variables threaded from a worktree's .ports.env into spawned
# `claude` / `npm` subprocesses (see worktree_ops.setup_worktree_environment).
PORT_ENV_KEYS = (
    "PORT",
    "CLIENT_DEV_PORT",
    "API_PROXY_TARGET",
    "VRP_DB_PATH",
    "E2E_SERVER_PORT",
    "E2E_CLIENT_PORT",
    "PLAYWRIGHT_BROWSERS_PATH",
)


def get_safe_subprocess_env() -> Dict[str, str]:
    """Return a filtered environment safe for subprocess execution.

    Only the variables ADW workflows actually need, to avoid leaking unrelated
    credentials into spawned processes.
    """
    safe_env_vars = {
        # Claude Code authentication (subscription OAuth token preferred).
        "CLAUDE_CODE_OAUTH_TOKEN": os.getenv("CLAUDE_CODE_OAUTH_TOKEN"),
        "ANTHROPIC_API_KEY": os.getenv("ANTHROPIC_API_KEY"),
        # Claude Code configuration
        "CLAUDE_CODE_PATH": os.getenv("CLAUDE_CODE_PATH", "claude"),
        "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": os.getenv(
            "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR", "true"
        ),
        # GitHub configuration (optional; falls back to ambient gh auth).
        "GITHUB_PAT": os.getenv("GITHUB_PAT"),
        "GH_TOKEN": os.getenv("GH_TOKEN"),
        # ADW execution context
        "ADW_IN_CI": os.getenv("ADW_IN_CI"),
        # Vendor Risk Portal app runtime knobs (offline-friendly defaults).
        "AUTH_MODE": os.getenv("AUTH_MODE"),
        "NODE_ENV": os.getenv("NODE_ENV"),
        # Essential system environment variables
        "HOME": os.getenv("HOME"),
        "USER": os.getenv("USER"),
        "PATH": os.getenv("PATH"),
        "SHELL": os.getenv("SHELL"),
        "TERM": os.getenv("TERM"),
        "LANG": os.getenv("LANG"),
        "LC_ALL": os.getenv("LC_ALL"),
        # Python-specific
        "PYTHONPATH": os.getenv("PYTHONPATH"),
        "PYTHONUNBUFFERED": "1",
        # Working directory tracking
        "PWD": os.getcwd(),
    }

    # Thread through any per-worktree port/db env vars that are set.
    for key in PORT_ENV_KEYS:
        if os.getenv(key) is not None:
            safe_env_vars[key] = os.getenv(key)

    # Mirror GITHUB_PAT to GH_TOKEN if only the former is set.
    github_pat = os.getenv("GITHUB_PAT")
    if github_pat and not safe_env_vars.get("GH_TOKEN"):
        safe_env_vars["GH_TOKEN"] = github_pat

    return {k: v for k, v in safe_env_vars.items() if v is not None}
