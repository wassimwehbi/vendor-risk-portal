"""Test execution + automatic resolution loops for ADW.

Ported from tac-8's adw_test_iso.py, factored into a module so both the test
phase and the ship loop can reuse it. The /test command returns a JSON array of
TestResult; failures are handed to /resolve_failed_test and re-run, bounded by a
retry cap.
"""

import logging
from typing import List, Optional, Tuple

from adw_modules.agent import execute_template
from adw_modules.data_types import (
    AgentTemplateRequest,
    AgentPromptResponse,
    TestResult,
    E2ETestResult,
)
from adw_modules.utils import parse_json
from adw_modules.phase import post

AGENT_TESTER = "test_runner"
AGENT_E2E_TESTER = "e2e_test_runner"

MAX_TEST_RETRY_ATTEMPTS = 4
MAX_E2E_TEST_RETRY_ATTEMPTS = 2


def _run(slash: str, agent: str, adw_id: str, working_dir: Optional[str]) -> AgentPromptResponse:
    return execute_template(
        AgentTemplateRequest(
            agent_name=agent, slash_command=slash, args=[], adw_id=adw_id, working_dir=working_dir
        )
    )


def parse_test_results(
    output: str, logger: logging.Logger
) -> Tuple[List[TestResult], int, int]:
    try:
        results = parse_json(output, List[TestResult])
        passed = sum(1 for t in results if t.passed)
        return results, passed, len(results) - passed
    except Exception as e:
        logger.error(f"Error parsing test results: {e}")
        return [], 0, 0


def parse_e2e_test_results(
    output: str, logger: logging.Logger
) -> Tuple[List[E2ETestResult], int, int]:
    try:
        results = parse_json(output, List[E2ETestResult])
        passed = sum(1 for t in results if t.passed)
        return results, passed, len(results) - passed
    except Exception as e:
        logger.error(f"Error parsing E2E test results: {e}")
        return [], 0, 0


def format_test_results_comment(results: List[TestResult], passed: int, failed: int) -> str:
    if not results:
        return "❌ No test results found"
    lines = []
    failed_tests = [t for t in results if not t.passed]
    if failed_tests:
        lines.append("## ❌ Failed Tests")
        for t in failed_tests:
            lines.append(f"- `{t.execution_command}` — {t.test_name}")
            if t.error:
                lines.append(f"  - {t.error[:300]}")
    lines.append(f"\n## Summary\n- Passed: {passed}\n- Failed: {failed}\n- Total: {len(results)}")
    return "\n".join(lines)


def _resolve_failed(
    slash: str,
    failed_tests: list,
    adw_id: str,
    issue_number: str,
    logger: logging.Logger,
    working_dir: str,
    iteration: int,
) -> Tuple[int, int]:
    resolved = unresolved = 0
    for idx, test in enumerate(failed_tests):
        agent_name = f"test_resolver_iter{iteration}_{idx}"
        payload = test.model_dump_json(indent=2)
        post(issue_number, adw_id, agent_name, f"🔧 Resolving: {test.test_name}")
        response = execute_template(
            AgentTemplateRequest(
                agent_name=agent_name,
                slash_command=slash,
                args=[payload],
                adw_id=adw_id,
                working_dir=working_dir,
            )
        )
        if response.success:
            resolved += 1
            logger.info(f"Resolved: {test.test_name}")
        else:
            unresolved += 1
            logger.error(f"Failed to resolve: {test.test_name}")
    return resolved, unresolved


def run_tests_with_resolution(
    adw_id: str,
    issue_number: str,
    logger: logging.Logger,
    working_dir: str,
    max_attempts: int = MAX_TEST_RETRY_ATTEMPTS,
) -> Tuple[List[TestResult], int, int, Optional[AgentPromptResponse]]:
    """Run /test, resolving failures via /resolve_failed_test and re-running."""
    results: List[TestResult] = []
    passed = failed = 0
    response = None

    for attempt in range(1, max_attempts + 1):
        logger.info(f"=== Test attempt {attempt}/{max_attempts} ===")
        response = _run("/test", AGENT_TESTER, adw_id, working_dir)
        if not response.success:
            logger.error(f"Error running tests: {response.output}")
            post(issue_number, adw_id, AGENT_TESTER, f"❌ Error running tests: {response.output}")
            break

        results, passed, failed = parse_test_results(response.output, logger)
        if failed == 0 or attempt == max_attempts:
            break

        post(issue_number, adw_id, "ops", f"🔧 {failed} failed tests; attempting resolution…")
        resolved, _ = _resolve_failed(
            "/resolve_failed_test",
            [t for t in results if not t.passed],
            adw_id,
            issue_number,
            logger,
            working_dir,
            attempt,
        )
        if resolved == 0:
            logger.info("No tests resolved; stopping retries")
            break

    return results, passed, failed, response


def run_e2e_tests_with_resolution(
    adw_id: str,
    issue_number: str,
    logger: logging.Logger,
    working_dir: str,
    max_attempts: int = MAX_E2E_TEST_RETRY_ATTEMPTS,
) -> Tuple[List[E2ETestResult], int, int]:
    """Run /test_e2e, resolving failures via /resolve_failed_e2e_test."""
    results: List[E2ETestResult] = []
    passed = failed = 0

    for attempt in range(1, max_attempts + 1):
        logger.info(f"=== E2E attempt {attempt}/{max_attempts} ===")
        response = _run("/test_e2e", AGENT_E2E_TESTER, adw_id, working_dir)
        if not response.success:
            logger.error(f"Error running E2E tests: {response.output}")
            post(issue_number, adw_id, AGENT_E2E_TESTER, f"❌ Error running E2E: {response.output}")
            break

        results, passed, failed = parse_e2e_test_results(response.output, logger)
        if not results or failed == 0 or attempt == max_attempts:
            break

        post(issue_number, adw_id, "ops", f"🔧 {failed} failed E2E tests; attempting resolution…")
        resolved, _ = _resolve_failed(
            "/resolve_failed_e2e_test",
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
