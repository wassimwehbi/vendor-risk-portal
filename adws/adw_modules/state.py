"""State management for the ADW composable architecture.

Persistent state lives in agents/{adw_id}/adw_state.json (outside the worktree,
so it survives worktree removal). Transient state is passed between scripts via
stdin/stdout.
"""

import json
import os
import sys
import logging
from typing import Dict, Any, Optional
from adw_modules.data_types import ADWStateData

# The set of fields persisted to / restored from adw_state.json.
CORE_FIELDS = {
    "adw_id",
    "issue_number",
    "branch_name",
    "plan_file",
    "issue_class",
    "worktree_path",
    "backend_port",
    "frontend_port",
    "e2e_server_port",
    "e2e_client_port",
    "db_path",
    "model_set",
    "all_adws",
    "is_ux_work",
    "ux_signal",
}


class ADWState:
    """Container for ADW workflow state with file persistence."""

    STATE_FILENAME = "adw_state.json"

    def __init__(self, adw_id: str):
        if not adw_id:
            raise ValueError("adw_id is required for ADWState")

        self.adw_id = adw_id
        self.data: Dict[str, Any] = {"adw_id": self.adw_id}
        self.logger = logging.getLogger(__name__)

    def update(self, **kwargs):
        """Update state with new key-value pairs (core fields only)."""
        for key, value in kwargs.items():
            if key in CORE_FIELDS:
                self.data[key] = value

    def get(self, key: str, default=None):
        """Get a value from state by key."""
        return self.data.get(key, default)

    def append_adw_id(self, adw_id: str):
        """Append an ADW ID to all_adws if not already present."""
        all_adws = self.data.get("all_adws", [])
        if adw_id not in all_adws:
            all_adws.append(adw_id)
            self.data["all_adws"] = all_adws

    def get_working_directory(self) -> str:
        """Working directory for this ADW: worktree_path if set, else repo root."""
        worktree_path = self.data.get("worktree_path")
        if worktree_path:
            return worktree_path
        return os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )

    def get_state_path(self) -> str:
        """Path to the state file."""
        project_root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        return os.path.join(project_root, "agents", self.adw_id, self.STATE_FILENAME)

    def save(self, workflow_step: Optional[str] = None) -> None:
        """Save state to agents/{adw_id}/adw_state.json (validated)."""
        state_path = self.get_state_path()
        os.makedirs(os.path.dirname(state_path), exist_ok=True)

        state_data = ADWStateData(
            adw_id=self.data.get("adw_id"),
            issue_number=self.data.get("issue_number"),
            branch_name=self.data.get("branch_name"),
            plan_file=self.data.get("plan_file"),
            issue_class=self.data.get("issue_class"),
            worktree_path=self.data.get("worktree_path"),
            backend_port=self.data.get("backend_port"),
            frontend_port=self.data.get("frontend_port"),
            e2e_server_port=self.data.get("e2e_server_port"),
            e2e_client_port=self.data.get("e2e_client_port"),
            db_path=self.data.get("db_path"),
            model_set=self.data.get("model_set", "base"),
            all_adws=self.data.get("all_adws", []),
            is_ux_work=self.data.get("is_ux_work"),
            ux_signal=self.data.get("ux_signal"),
        )

        with open(state_path, "w") as f:
            json.dump(state_data.model_dump(), f, indent=2)

        self.logger.info(f"Saved state to {state_path}")
        if workflow_step:
            self.logger.info(f"State updated by: {workflow_step}")

    @classmethod
    def load(
        cls, adw_id: str, logger: Optional[logging.Logger] = None
    ) -> Optional["ADWState"]:
        """Load state from file if it exists."""
        project_root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        state_path = os.path.join(project_root, "agents", adw_id, cls.STATE_FILENAME)

        if not os.path.exists(state_path):
            return None

        try:
            with open(state_path, "r") as f:
                data = json.load(f)

            state_data = ADWStateData(**data)
            state = cls(state_data.adw_id)
            state.data = state_data.model_dump()

            if logger:
                logger.info(f"🔍 Found existing state from {state_path}")
                logger.info(f"State: {json.dumps(state_data.model_dump(), indent=2)}")

            return state
        except Exception as e:
            if logger:
                logger.error(f"Failed to load state from {state_path}: {e}")
            return None

    @classmethod
    def from_stdin(cls) -> Optional["ADWState"]:
        """Read state from stdin (for piped input), or None if stdin is a tty."""
        if sys.stdin.isatty():
            return None
        try:
            input_data = sys.stdin.read()
            if not input_data.strip():
                return None
            data = json.loads(input_data)
            adw_id = data.get("adw_id")
            if not adw_id:
                return None
            state = cls(adw_id)
            state.data = data
            return state
        except (json.JSONDecodeError, EOFError):
            return None

    def to_stdout(self):
        """Write core state to stdout as JSON (for piping to the next script)."""
        output_data = {field: self.data.get(field) for field in CORE_FIELDS}
        output_data["all_adws"] = self.data.get("all_adws", [])
        print(json.dumps(output_data, indent=2))
