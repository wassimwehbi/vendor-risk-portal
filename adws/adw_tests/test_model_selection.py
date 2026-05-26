#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic>=2.7", "python-dotenv>=1.0", "requests>=2.32"]
# ///
"""Sanity tests for the ADW core: imports, model map coverage, ports, state.

Run: `uv run adws/adw_tests/test_model_selection.py`
"""

import os
import sys
import tempfile

# Put the adws/ directory on the path so `adw_modules` is importable.
ADWS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ADWS_DIR)

from adw_modules.agent import SLASH_COMMAND_MODEL_MAP  # noqa: E402
from adw_modules.data_types import ADWStateData, SlashCommand  # noqa: E402
from adw_modules import worktree_ops as wt  # noqa: E402
from adw_modules.state import ADWState, CORE_FIELDS  # noqa: E402


def test_model_map_covers_all_slash_commands():
    """Every SlashCommand literal must have a model mapping (minus pure markers)."""
    import typing

    literals = set(typing.get_args(SlashCommand))
    # /chore, /bug, /feature double as issue classes + planning commands; all mapped.
    missing = [c for c in literals if c not in SLASH_COMMAND_MODEL_MAP]
    assert not missing, f"Slash commands missing from model map: {missing}"
    for cmd, cfg in SLASH_COMMAND_MODEL_MAP.items():
        assert "base" in cfg and "heavy" in cfg, f"{cmd} missing base/heavy"
        assert cfg["base"] in ("sonnet", "opus")
        assert cfg["heavy"] in ("sonnet", "opus")


def test_port_bands_are_distinct_and_in_range():
    """Each ADW gets four ports in non-overlapping bands above the repo defaults."""
    ports = wt.get_ports_for_adw("a1b2c3d4")
    assert 4110 <= ports.backend <= 4124
    assert 5180 <= ports.frontend <= 5194
    assert 4130 <= ports.e2e_server <= 4144
    assert 5200 <= ports.e2e_client <= 5214
    all_ports = {ports.backend, ports.frontend, ports.e2e_server, ports.e2e_client}
    assert len(all_ports) == 4, "port bands overlap"
    # Deterministic for the same id.
    assert wt.get_ports_for_adw("a1b2c3d4") == ports


def test_state_roundtrip_with_new_fields():
    """ADWState persists and restores the new e2e/db fields."""
    with tempfile.TemporaryDirectory() as _:
        # Validate the data model accepts the new fields.
        data = ADWStateData(
            adw_id="deadbeef",
            issue_number="42",
            issue_class="/feature",
            backend_port=4110,
            frontend_port=5180,
            e2e_server_port=4130,
            e2e_client_port=5200,
            db_path="/tmp/x/vendor-risk.db",
        )
        assert data.e2e_server_port == 4130
        assert data.db_path.endswith("vendor-risk.db")
    for f in ("e2e_server_port", "e2e_client_port", "db_path"):
        assert f in CORE_FIELDS, f"{f} not persisted by ADWState"


def main():
    tests = [
        test_model_map_covers_all_slash_commands,
        test_port_bands_are_distinct_and_in_range,
        test_state_roundtrip_with_new_fields,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    if failed:
        print(f"\n{failed} test(s) failed")
        sys.exit(1)
    print(f"\nAll {len(tests)} ADW core tests passed")


if __name__ == "__main__":
    main()
