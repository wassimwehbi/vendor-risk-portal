"""Worktree and port management for isolated ADW workflows.

Creates git worktrees under trees/<adw_id>/ (kept separate from the harness's
.claude/worktrees/) and allocates four non-overlapping port bands per worktree so
up to 15 ADW instances can run concurrently without colliding with each other or
with the repo's dev (4100/5173) and Playwright (4101/5174) defaults.
"""

import os
import shutil
import socket
import subprocess
import logging
from typing import NamedTuple, Optional, Tuple

from adw_modules.state import ADWState

# Number of concurrent ADW slots and the base of each port band.
PORT_SLOTS = 15
BACKEND_BASE = 4110     # dev server PORT          → 4110..4124
FRONTEND_BASE = 5180    # dev client CLIENT_DEV_PORT → 5180..5194
E2E_SERVER_BASE = 4130  # Playwright server PORT    → 4130..4144
E2E_CLIENT_BASE = 5200  # Playwright client port    → 5200..5214


class PortSet(NamedTuple):
    backend: int
    frontend: int
    e2e_server: int
    e2e_client: int


def _ports_for_index(index: int) -> PortSet:
    return PortSet(
        backend=BACKEND_BASE + index,
        frontend=FRONTEND_BASE + index,
        e2e_server=E2E_SERVER_BASE + index,
        e2e_client=E2E_CLIENT_BASE + index,
    )


def get_ports_for_adw(adw_id: str) -> PortSet:
    """Deterministically map an ADW ID to a port slot (0..14)."""
    try:
        id_chars = "".join(c for c in adw_id[:8] if c.isalnum())
        index = int(id_chars, 36) % PORT_SLOTS
    except ValueError:
        index = hash(adw_id) % PORT_SLOTS
    return _ports_for_index(index)


def is_port_available(port: int) -> bool:
    """Check whether a TCP port is free to bind on localhost."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            s.bind(("localhost", port))
            return True
    except (socket.error, OSError):
        return False


def find_next_available_ports(adw_id: str, max_attempts: int = PORT_SLOTS) -> PortSet:
    """Find a slot whose four ports are all free, starting from the deterministic one."""
    base = get_ports_for_adw(adw_id)
    base_index = base.backend - BACKEND_BASE

    for offset in range(max_attempts):
        index = (base_index + offset) % PORT_SLOTS
        ports = _ports_for_index(index)
        if all(
            is_port_available(p)
            for p in (ports.backend, ports.frontend, ports.e2e_server, ports.e2e_client)
        ):
            return ports

    raise RuntimeError("No available port slot in the allocated ranges")


def _project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_worktree_path(adw_id: str) -> str:
    """Absolute path to the worktree directory for an ADW."""
    return os.path.join(_project_root(), "trees", adw_id)


def create_worktree(
    adw_id: str, branch_name: str, logger: logging.Logger
) -> Tuple[Optional[str], Optional[str]]:
    """Create a git worktree under trees/<adw_id>/ branched from origin/main."""
    project_root = _project_root()
    trees_dir = os.path.join(project_root, "trees")
    os.makedirs(trees_dir, exist_ok=True)

    worktree_path = os.path.join(trees_dir, adw_id)
    if os.path.exists(worktree_path):
        logger.warning(f"Worktree already exists at {worktree_path}")
        return worktree_path, None

    logger.info("Fetching latest changes from origin")
    fetch = subprocess.run(
        ["git", "fetch", "origin"], capture_output=True, text=True, cwd=project_root
    )
    if fetch.returncode != 0:
        logger.warning(f"Failed to fetch from origin: {fetch.stderr}")

    # Base ref for the worktree. Defaults to origin/main; override with
    # ADW_WORKTREE_BASE (e.g. to a feature branch) so a local run can include
    # the ZTE layer before it is merged to main.
    base_ref = os.environ.get("ADW_WORKTREE_BASE", "origin/main")
    logger.info(f"Creating worktree from base ref: {base_ref}")
    cmd = ["git", "worktree", "add", "-b", branch_name, worktree_path, base_ref]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=project_root)
    if result.returncode != 0:
        if "already exists" in result.stderr:
            cmd = ["git", "worktree", "add", worktree_path, branch_name]
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=project_root)
        if result.returncode != 0:
            error_msg = f"Failed to create worktree: {result.stderr}"
            logger.error(error_msg)
            return None, error_msg

    logger.info(f"Created worktree at {worktree_path} for branch {branch_name}")
    return worktree_path, None


def validate_worktree(adw_id: str, state: ADWState) -> Tuple[bool, Optional[str]]:
    """Three-way validation: state has path, dir exists, git knows it."""
    worktree_path = state.get("worktree_path")
    if not worktree_path:
        return False, "No worktree_path in state"
    if not os.path.exists(worktree_path):
        return False, f"Worktree directory not found: {worktree_path}"
    result = subprocess.run(["git", "worktree", "list"], capture_output=True, text=True)
    if worktree_path not in result.stdout:
        return False, "Worktree not registered with git"
    return True, None


def remove_worktree(adw_id: str, logger: logging.Logger) -> Tuple[bool, Optional[str]]:
    """Remove a worktree (git first, then manual cleanup if needed)."""
    worktree_path = get_worktree_path(adw_id)
    result = subprocess.run(
        ["git", "worktree", "remove", worktree_path, "--force"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 and os.path.exists(worktree_path):
        try:
            shutil.rmtree(worktree_path)
            logger.warning(f"Manually removed worktree directory: {worktree_path}")
        except Exception as e:
            return False, f"Failed to remove worktree: {result.stderr}, cleanup failed: {e}"

    logger.info(f"Removed worktree at {worktree_path}")
    return True, None


def setup_worktree_environment(
    worktree_path: str, ports: PortSet, logger: logging.Logger
) -> str:
    """Write .ports.env into the worktree and return the per-worktree DB path.

    The actual dependency install + browser setup is performed by the
    install_worktree.md command running inside the worktree; here we only lay
    down the env contract that the server/client/Playwright read.
    """
    db_dir = os.path.join(worktree_path, ".adw-db")
    os.makedirs(db_dir, exist_ok=True)
    db_path = os.path.join(db_dir, "vendor-risk.db")

    browsers_path = os.environ.get(
        "PLAYWRIGHT_BROWSERS_PATH", os.path.expanduser("~/.cache/ms-playwright")
    )

    ports_env_path = os.path.join(worktree_path, ".ports.env")
    with open(ports_env_path, "w") as f:
        f.write(f"export PORT={ports.backend}\n")
        f.write(f"export CLIENT_DEV_PORT={ports.frontend}\n")
        f.write(f"export API_PROXY_TARGET=http://localhost:{ports.backend}\n")
        f.write(f"export VRP_DB_PATH={db_path}\n")
        f.write(f"export E2E_SERVER_PORT={ports.e2e_server}\n")
        f.write(f"export E2E_CLIENT_PORT={ports.e2e_client}\n")
        f.write(f"export PLAYWRIGHT_BROWSERS_PATH={browsers_path}\n")

    logger.info(
        f"Wrote .ports.env (backend={ports.backend}, frontend={ports.frontend}, "
        f"e2e_server={ports.e2e_server}, e2e_client={ports.e2e_client})"
    )
    return db_path
