"""Shared AI Developer Workflow (ADW) operations.

Ported from tac-8 and adapted so generated plan-specs live under specs/adw/
(disjoint from the hand-authored specs/NNNN-*.md design docs).
"""

import glob
import json
import logging
import os
import subprocess
import re
from typing import Tuple, Optional

from adw_modules.data_types import (
    AgentTemplateRequest,
    GitHubIssue,
    AgentPromptResponse,
    IssueClassSlashCommand,
    ADWExtractionResult,
)
from adw_modules.agent import execute_template
from adw_modules.github import ADW_BOT_IDENTIFIER
from adw_modules.state import ADWState
from adw_modules.utils import parse_json

# Agent name constants
AGENT_PLANNER = "sdlc_planner"
AGENT_IMPLEMENTOR = "sdlc_implementor"
AGENT_CLASSIFIER = "issue_classifier"
AGENT_BRANCH_GENERATOR = "branch_generator"
AGENT_PR_CREATOR = "pr_creator"

# Where ADW-generated plan-specs are written (kept out of the NNNN namespace).
ADW_SPEC_DIR = "specs/adw"

AVAILABLE_ADW_WORKFLOWS = [
    "adw_plan",
    "adw_patch",
    "adw_build",
    "adw_test",
    "adw_review",
    "adw_document",
    "adw_ship",
    "adw_sdlc_zte",
    "adw_plan_build",
    "adw_plan_build_test",
    "adw_plan_build_test_review",
    "adw_plan_build_document",
    "adw_plan_build_review",
    "adw_sdlc",
]


def format_issue_message(
    adw_id: str, agent_name: str, message: str, session_id: Optional[str] = None
) -> str:
    """Format an issue-comment message with ADW tracking + bot identifier."""
    if session_id:
        return f"{ADW_BOT_IDENTIFIER} {adw_id}_{agent_name}_{session_id}: {message}"
    return f"{ADW_BOT_IDENTIFIER} {adw_id}_{agent_name}: {message}"


def extract_adw_info(text: str, temp_adw_id: str) -> ADWExtractionResult:
    """Extract workflow command, ADW ID, and model_set from text via /classify_adw."""
    request = AgentTemplateRequest(
        agent_name="adw_classifier",
        slash_command="/classify_adw",
        args=[text],
        adw_id=temp_adw_id,
    )
    try:
        response = execute_template(request)
        if not response.success:
            print(f"Failed to classify ADW: {response.output}")
            return ADWExtractionResult()

        try:
            data = parse_json(response.output, dict)
            adw_command = data.get("adw_slash_command", "").replace("/", "")
            adw_id = data.get("adw_id")
            model_set = data.get("model_set", "base")
            # Case-insensitive match → canonical workflow name, so the
            # uppercase-ZTE safety signal ("adw_sdlc_ZTE") still resolves to
            # the real lowercase "adw_sdlc_zte" instead of being dropped.
            canonical = next(
                (w for w in AVAILABLE_ADW_WORKFLOWS if w.lower() == adw_command.lower()),
                None,
            )
            if canonical:
                return ADWExtractionResult(
                    workflow_command=canonical, adw_id=adw_id, model_set=model_set
                )
            return ADWExtractionResult()
        except ValueError as e:
            print(f"Failed to parse classify_adw response: {e}")
            return ADWExtractionResult()
    except Exception as e:
        print(f"Error calling classify_adw: {e}")
        return ADWExtractionResult()


def classify_issue(
    issue: GitHubIssue, adw_id: str, logger: logging.Logger
) -> Tuple[Optional[IssueClassSlashCommand], Optional[str]]:
    """Classify a GitHub issue into a planning slash command."""
    minimal_issue_json = issue.model_dump_json(
        by_alias=True, include={"number", "title", "body"}
    )
    request = AgentTemplateRequest(
        agent_name=AGENT_CLASSIFIER,
        slash_command="/classify_issue",
        args=[minimal_issue_json],
        adw_id=adw_id,
    )
    logger.debug(f"Classifying issue: {issue.title}")
    response = execute_template(request)
    if not response.success:
        return None, response.output

    output = response.output.strip()
    match = re.search(r"(/chore|/bug|/feature|/patch|0)", output)
    issue_command = match.group(1) if match else output

    if issue_command == "0":
        return None, f"No command selected: {response.output}"
    if issue_command not in ["/chore", "/bug", "/feature", "/patch"]:
        return None, f"Invalid command selected: {response.output}"
    return issue_command, None  # type: ignore


def build_plan(
    issue: GitHubIssue,
    command: str,
    adw_id: str,
    logger: logging.Logger,
    working_dir: Optional[str] = None,
) -> AgentPromptResponse:
    """Build an implementation plan for the issue using the given command."""
    minimal_issue_json = issue.model_dump_json(
        by_alias=True, include={"number", "title", "body"}
    )
    request = AgentTemplateRequest(
        agent_name=AGENT_PLANNER,
        slash_command=command,
        args=[str(issue.number), adw_id, minimal_issue_json],
        adw_id=adw_id,
        working_dir=working_dir,
    )
    logger.debug("Building plan")
    return execute_template(request)


def implement_plan(
    plan_file: str,
    adw_id: str,
    logger: logging.Logger,
    agent_name: Optional[str] = None,
    working_dir: Optional[str] = None,
) -> AgentPromptResponse:
    """Implement a plan via /implement."""
    request = AgentTemplateRequest(
        agent_name=agent_name or AGENT_IMPLEMENTOR,
        slash_command="/implement",
        args=[plan_file],
        adw_id=adw_id,
        working_dir=working_dir,
    )
    logger.debug(f"Implementing plan: {plan_file}")
    return execute_template(request)


def generate_branch_name(
    issue: GitHubIssue,
    issue_class: IssueClassSlashCommand,
    adw_id: str,
    logger: logging.Logger,
) -> Tuple[Optional[str], Optional[str]]:
    """Generate a git branch name for the issue."""
    issue_type = issue_class.replace("/", "")
    minimal_issue_json = issue.model_dump_json(
        by_alias=True, include={"number", "title", "body"}
    )
    request = AgentTemplateRequest(
        agent_name=AGENT_BRANCH_GENERATOR,
        slash_command="/generate_branch_name",
        args=[issue_type, adw_id, minimal_issue_json],
        adw_id=adw_id,
    )
    response = execute_template(request)
    if not response.success:
        return None, response.output
    branch_name = response.output.strip()
    logger.info(f"Generated branch name: {branch_name}")
    return branch_name, None


def create_commit(
    agent_name: str,
    issue: GitHubIssue,
    issue_class: IssueClassSlashCommand,
    adw_id: str,
    logger: logging.Logger,
    working_dir: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Create a git commit with a properly formatted message via /commit."""
    issue_type = issue_class.replace("/", "")
    minimal_issue_json = issue.model_dump_json(
        by_alias=True, include={"number", "title", "body"}
    )
    request = AgentTemplateRequest(
        agent_name=f"{agent_name}_committer",
        slash_command="/commit",
        args=[agent_name, issue_type, minimal_issue_json],
        adw_id=adw_id,
        working_dir=working_dir,
    )
    response = execute_template(request)
    if not response.success:
        return None, response.output
    commit_message = response.output.strip()
    logger.info(f"Created commit: {commit_message}")
    return commit_message, None


def create_pull_request(
    branch_name: str,
    issue,
    state: ADWState,
    logger: logging.Logger,
    working_dir: str,
) -> Tuple[Optional[str], Optional[str]]:
    """Create a pull request for the implemented changes via /pull_request."""
    plan_file = state.get("plan_file") or "No plan file (test run)"
    adw_id = state.get("adw_id")

    if not issue:
        issue_json = "{}"
    elif isinstance(issue, dict):
        from adw_modules.data_types import GitHubIssue as _GitHubIssue

        try:
            issue_json = _GitHubIssue(**issue).model_dump_json(
                by_alias=True, include={"number", "title", "body"}
            )
        except Exception:
            issue_json = json.dumps(issue, default=str)
    else:
        issue_json = issue.model_dump_json(
            by_alias=True, include={"number", "title", "body"}
        )

    request = AgentTemplateRequest(
        agent_name=AGENT_PR_CREATOR,
        slash_command="/pull_request",
        args=[branch_name, issue_json, plan_file, adw_id],
        adw_id=adw_id,
        working_dir=working_dir,
    )
    response = execute_template(request)
    if not response.success:
        return None, response.output
    pr_url = response.output.strip()
    logger.info(f"Created pull request: {pr_url}")
    return pr_url, None


def ensure_plan_exists(state: ADWState, issue_number: str) -> str:
    """Find or error if no plan exists for the issue (used by build workflows)."""
    if state.get("plan_file"):
        return state.get("plan_file")

    from adw_modules.git_ops import get_current_branch

    cwd = state.get("worktree_path")
    branch = get_current_branch(cwd=cwd)
    if f"-issue-{issue_number}-" in branch or f"-{issue_number}-" in branch:
        for pattern in (
            f"{ADW_SPEC_DIR}/*{issue_number}*.md",
            f"specs/*{issue_number}*.md",
        ):
            search = os.path.join(cwd, pattern) if cwd else pattern
            plans = glob.glob(search)
            if plans:
                return plans[0]

    raise ValueError(
        f"No plan found for issue {issue_number}. Run adw_plan.py first."
    )


def ensure_adw_id(
    issue_number: str,
    adw_id: Optional[str] = None,
    logger: Optional[logging.Logger] = None,
) -> str:
    """Get an ADW ID or create one and initialize its state."""
    if adw_id:
        state = ADWState.load(adw_id, logger)
        if state:
            (logger.info if logger else print)(f"Found existing ADW state: {adw_id}")
            return adw_id
        state = ADWState(adw_id)
        state.update(adw_id=adw_id, issue_number=issue_number)
        state.save("ensure_adw_id")
        (logger.info if logger else print)(f"Created ADW state for provided ID: {adw_id}")
        return adw_id

    from adw_modules.utils import make_adw_id

    new_adw_id = make_adw_id()
    state = ADWState(new_adw_id)
    state.update(adw_id=new_adw_id, issue_number=issue_number)
    state.save("ensure_adw_id")
    (logger.info if logger else print)(f"Created new ADW ID and state: {new_adw_id}")
    return new_adw_id


def find_existing_branch_for_issue(
    issue_number: str, adw_id: Optional[str] = None, cwd: Optional[str] = None
) -> Optional[str]:
    """Find an existing branch matching *-issue-<n>-adw-<id>-* for the issue."""
    result = subprocess.run(
        ["git", "branch", "-a"], capture_output=True, text=True, cwd=cwd
    )
    if result.returncode != 0:
        return None
    for branch in result.stdout.strip().split("\n"):
        branch = branch.strip().replace("* ", "").replace("remotes/origin/", "")
        if f"-issue-{issue_number}-" in branch:
            if adw_id and f"-adw-{adw_id}-" in branch:
                return branch
            if not adw_id:
                return branch
    return None


def find_spec_file(state: ADWState, logger: logging.Logger) -> Optional[str]:
    """Find the plan-spec from state or by examining the git diff vs origin/main."""
    worktree_path = state.get("worktree_path")

    spec_file = state.get("plan_file")
    if spec_file:
        if worktree_path and not os.path.isabs(spec_file):
            spec_file = os.path.join(worktree_path, spec_file)
        if os.path.exists(spec_file):
            logger.info(f"Using spec file from state: {spec_file}")
            return spec_file

    logger.info("Looking for spec file in git diff")
    result = subprocess.run(
        ["git", "diff", "origin/main", "--name-only"],
        capture_output=True,
        text=True,
        cwd=worktree_path,
    )
    if result.returncode == 0:
        files = result.stdout.strip().split("\n")
        spec_files = [f for f in files if f.startswith("specs/") and f.endswith(".md")]
        # Prefer an ADW plan-spec under specs/adw/ if present.
        spec_files.sort(key=lambda f: 0 if f.startswith(f"{ADW_SPEC_DIR}/") else 1)
        if spec_files:
            spec_file = spec_files[0]
            if worktree_path:
                spec_file = os.path.join(worktree_path, spec_file)
            logger.info(f"Found spec file: {spec_file}")
            return spec_file

    branch_name = state.get("branch_name")
    if branch_name:
        match = re.search(r"issue-(\d+)", branch_name)
        if match:
            issue_num = match.group(1)
            adw_id = state.get("adw_id")
            search_dir = worktree_path if worktree_path else os.getcwd()
            pattern = os.path.join(
                search_dir, f"{ADW_SPEC_DIR}/issue-{issue_num}-adw-{adw_id}*.md"
            )
            spec_files = glob.glob(pattern)
            if spec_files:
                logger.info(f"Found spec file by pattern: {spec_files[0]}")
                return spec_files[0]

    logger.warning("No spec file found")
    return None


def create_and_implement_patch(
    adw_id: str,
    review_change_request: str,
    logger: logging.Logger,
    agent_name_planner: str,
    agent_name_implementor: str,
    spec_path: Optional[str] = None,
    issue_screenshots: Optional[str] = None,
    working_dir: Optional[str] = None,
) -> Tuple[Optional[str], AgentPromptResponse]:
    """Create a patch plan via /patch and implement it."""
    args = [adw_id, review_change_request]
    args.append(spec_path if spec_path else "")
    args.append(agent_name_planner)
    if issue_screenshots:
        args.append(issue_screenshots)

    request = AgentTemplateRequest(
        agent_name=agent_name_planner,
        slash_command="/patch",
        args=args,
        adw_id=adw_id,
        working_dir=working_dir,
    )
    response = execute_template(request)
    if not response.success:
        logger.error(f"Error creating patch plan: {response.output}")
        return None, AgentPromptResponse(
            output=f"Failed to create patch plan: {response.output}", success=False
        )

    # Sanitize the returned path (the agent may wrap it in backticks/quotes or
    # add prose), then validate it points at a patch/adw plan-spec.
    raw = response.output.strip()
    m = re.search(r"((?:specs/patch|specs/adw)/[^\s`\"']+\.md)", raw)
    patch_file_path = m.group(1) if m else raw.strip("`\"' \n")
    if not patch_file_path.endswith(".md") or (
        "specs/patch/" not in patch_file_path and f"{ADW_SPEC_DIR}/" not in patch_file_path
    ):
        logger.error(f"Invalid patch plan path returned: {response.output[:200]}")
        return None, AgentPromptResponse(
            output=f"Invalid patch plan path: {response.output[:200]}", success=False
        )

    logger.info(f"Created patch plan: {patch_file_path}")
    implement_response = implement_plan(
        patch_file_path, adw_id, logger, agent_name_implementor, working_dir=working_dir
    )
    return patch_file_path, implement_response
