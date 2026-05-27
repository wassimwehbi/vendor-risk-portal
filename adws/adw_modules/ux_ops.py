"""UX test + visual-validation execution for the ADW UX phase (spec 0012).

Mirrors test_ops.py: ``/test_ux`` returns ``E2ETestResult[]`` (same shape as ``/test_e2e``,
so it reuses test_ops' parsing + resolve loop), and failures are handed to
``/resolve_failed_ux_test`` and re-run, bounded by a retry cap. The visual ``/ux_validate``
agent returns a ``UxValidationResult`` (PASS | NEEDS_FIXES | NOT_APPLICABLE).
"""

import logging
from typing import List, Optional, Tuple

from adw_modules.agent import execute_template
from adw_modules.data_types import (
    AgentPromptResponse,
    AgentTemplateRequest,
    E2ETestResult,
    UxValidationResult,
)
from adw_modules.phase import post
from adw_modules.test_ops import _resolve_failed, parse_e2e_test_results
from adw_modules.utils import parse_json

AGENT_UX_TESTER = "ux_test_runner"
AGENT_UX_VALIDATOR = "ux_validator"
MAX_UX_TEST_RETRY_ATTEMPTS = 2
MAX_UX_VALIDATION_ATTEMPTS = 3


def _run(slash: str, agent: str, adw_id: str, working_dir: Optional[str], args=None) -> AgentPromptResponse:
    return execute_template(
        AgentTemplateRequest(
            agent_name=agent, slash_command=slash, args=args or [], adw_id=adw_id, working_dir=working_dir
        )
    )


def run_ux_tests_with_resolution(
    adw_id: str,
    issue_number: str,
    logger: logging.Logger,
    working_dir: str,
    max_attempts: int = MAX_UX_TEST_RETRY_ATTEMPTS,
) -> Tuple[List[E2ETestResult], int, int]:
    """Run /test_ux (npm run test:ux), resolving failures via /resolve_failed_ux_test."""
    results: List[E2ETestResult] = []
    passed = failed = 0

    for attempt in range(1, max_attempts + 1):
        logger.info(f"=== UX test attempt {attempt}/{max_attempts} ===")
        response = _run("/test_ux", AGENT_UX_TESTER, adw_id, working_dir)
        if not response.success:
            logger.error(f"Error running UX tests: {response.output}")
            post(issue_number, adw_id, AGENT_UX_TESTER, f"❌ Error running UX tests: {response.output}")
            break

        results, passed, failed = parse_e2e_test_results(response.output, logger)
        # No results can mean the suite is absent in this checkout — treat as advisory pass.
        if not results or failed == 0 or attempt == max_attempts:
            break

        post(issue_number, adw_id, "ops", f"🔧 {failed} failed UX tests; attempting resolution…")
        resolved, _ = _resolve_failed(
            "/resolve_failed_ux_test",
            [t for t in results if not t.passed],
            adw_id,
            issue_number,
            logger,
            working_dir,
            attempt,
        )
        if resolved == 0:
            break

    return results, passed, failed


def run_ux_validate(adw_id: str, spec_file: Optional[str], working_dir: str) -> AgentPromptResponse:
    """Invoke /ux_validate — captures before/after evidence + audits the rendered change."""
    return _run("/ux_validate", AGENT_UX_VALIDATOR, adw_id, working_dir, args=[adw_id, spec_file or ""])


def parse_ux_validation(output: str, logger: logging.Logger) -> Optional[UxValidationResult]:
    try:
        return parse_json(output, UxValidationResult)
    except Exception as e:  # noqa: BLE001
        logger.error(f"Could not parse UX validation result: {e}")
        return None


def format_ux_validation_comment(result: UxValidationResult) -> str:
    """Markdown body for the PR/issue marker comment."""
    lines = [f"**Verdict:** `{result.verdict}`", "", result.summary or ""]
    if result.findings:
        lines.append("\n**Findings:**")
        for f in result.findings:
            icon = {"blocker": "🚫", "minor": "⚠️", "info": "ℹ️"}.get(f.severity, "•")
            lines.append(f"- {icon} **{f.severity}** — {f.description}")
    if result.acceptance_criteria_checked:
        lines.append("\n**Acceptance criteria checked:**")
        lines.extend(f"- {c}" for c in result.acceptance_criteria_checked)
    if result.evidence_paths:
        lines.append(f"\n_{len(result.evidence_paths)} evidence artifact(s) captured under `agents/<adw_id>/ux_validator/`._")
    return "\n".join(lines)
