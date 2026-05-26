"""Data types for GitHub API responses and the Claude Code agent.

Ported from tac-8 (tac8_app5__nlq_to_sql_aea) and adapted for the Vendor Risk
Portal: the ZTE workflow names are lower-cased, the ADW state carries dedicated
E2E ports and a per-worktree DB path, and Copilot-review models are added for the
zero-touch ship loop.
"""

from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field
from enum import Enum


# Retry codes for Claude Code execution errors
class RetryCode(str, Enum):
    """Codes indicating different types of errors that may be retryable."""

    CLAUDE_CODE_ERROR = "claude_code_error"  # General Claude Code CLI error
    TIMEOUT_ERROR = "timeout_error"  # Command timed out
    EXECUTION_ERROR = "execution_error"  # Error during execution
    ERROR_DURING_EXECUTION = "error_during_execution"  # Agent encountered an error
    NONE = "none"  # No retry needed


# Supported slash commands for issue classification.
# Includes /patch so the classifier can route quick fixes directly.
IssueClassSlashCommand = Literal["/chore", "/bug", "/feature", "/patch"]

# Model set types for ADW workflows
ModelSet = Literal["base", "heavy"]

# ADW workflow types (all isolated)
ADWWorkflow = Literal[
    "adw_plan",  # Planning only
    "adw_patch",  # Direct patch from issue
    "adw_build",  # Building only (dependent workflow)
    "adw_test",  # Testing only (dependent workflow)
    "adw_review",  # Review only (dependent workflow)
    "adw_document",  # Documentation only (dependent workflow)
    "adw_ship",  # Ship workflow (PR-based, Copilot-iterating, auto-merge)
    "adw_sdlc_zte",  # Zero-Touch Engineering: full SDLC with auto-merge
    "adw_plan_build",  # Plan + Build
    "adw_plan_build_test",  # Plan + Build + Test
    "adw_plan_build_test_review",  # Plan + Build + Test + Review
    "adw_plan_build_document",  # Plan + Build + Document
    "adw_plan_build_review",  # Plan + Build + Review
    "adw_sdlc",  # Complete SDLC: Plan + Build + Test + Review + Document
]

# All slash commands used in the ADW system.
SlashCommand = Literal[
    # Issue classification commands
    "/chore",
    "/bug",
    "/feature",
    # ADW workflow commands
    "/classify_issue",
    "/classify_adw",
    "/generate_branch_name",
    "/commit",
    "/pull_request",
    "/implement",
    "/test",
    "/resolve_failed_test",
    "/test_e2e",
    "/resolve_failed_e2e_test",
    "/review",
    "/patch",
    "/document",
    "/resolve_copilot_feedback",
    "/track_agentic_kpis",
    # Installation/setup commands
    "/install_worktree",
]


class GitHubUser(BaseModel):
    """GitHub user model."""

    id: Optional[str] = None  # Not always returned by GitHub API
    login: str
    name: Optional[str] = None
    is_bot: bool = Field(default=False, alias="is_bot")


class GitHubLabel(BaseModel):
    """GitHub label model."""

    id: str
    name: str
    color: str
    description: Optional[str] = None


class GitHubMilestone(BaseModel):
    """GitHub milestone model."""

    id: str
    number: int
    title: str
    description: Optional[str] = None
    state: str


class GitHubComment(BaseModel):
    """GitHub comment model."""

    id: str
    author: GitHubUser
    body: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: Optional[datetime] = Field(None, alias="updatedAt")


class GitHubIssueListItem(BaseModel):
    """GitHub issue model for list responses (simplified)."""

    number: int
    title: str
    body: str
    labels: List[GitHubLabel] = []
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    class Config:
        populate_by_name = True


class GitHubIssue(BaseModel):
    """GitHub issue model."""

    number: int
    title: str
    body: str
    state: str
    author: GitHubUser
    assignees: List[GitHubUser] = []
    labels: List[GitHubLabel] = []
    milestone: Optional[GitHubMilestone] = None
    comments: List[GitHubComment] = []
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    closed_at: Optional[datetime] = Field(None, alias="closedAt")
    url: str

    class Config:
        populate_by_name = True


class AgentPromptRequest(BaseModel):
    """Claude Code agent prompt configuration."""

    prompt: str
    adw_id: str
    agent_name: str = "ops"
    model: Literal["sonnet", "opus"] = "sonnet"
    dangerously_skip_permissions: bool = False
    output_file: str
    working_dir: Optional[str] = None


class AgentPromptResponse(BaseModel):
    """Claude Code agent response."""

    output: str
    success: bool
    session_id: Optional[str] = None
    retry_code: RetryCode = RetryCode.NONE


class AgentTemplateRequest(BaseModel):
    """Claude Code agent template execution request."""

    agent_name: str
    slash_command: SlashCommand
    args: List[str]
    adw_id: str
    model: Literal["sonnet", "opus"] = "sonnet"
    working_dir: Optional[str] = None


class ClaudeCodeResultMessage(BaseModel):
    """Claude Code JSONL result message (last line)."""

    type: str
    subtype: str
    is_error: bool
    duration_ms: int
    duration_api_ms: int
    num_turns: int
    result: str
    session_id: str
    total_cost_usd: float


class TestResult(BaseModel):
    """Individual test result from test suite execution."""

    test_name: str
    passed: bool
    execution_command: str
    test_purpose: Optional[str] = None
    error: Optional[str] = None


class E2ETestResult(BaseModel):
    """Individual E2E test result from browser automation."""

    test_name: str
    status: Literal["passed", "failed"]
    # Path to the test file for re-execution. Optional: some E2E reports (e.g. a
    # Playwright run summary) don't map to a single source file.
    test_path: Optional[str] = None
    screenshots: List[str] = []
    error: Optional[str] = None

    @property
    def passed(self) -> bool:
        """Check if test passed."""
        return self.status == "passed"


class ADWStateData(BaseModel):
    """Minimal persistent state for an ADW workflow.

    Stored in agents/{adw_id}/adw_state.json. Contains only the essential
    identifiers needed to connect workflow steps.

    Vendor Risk Portal additions vs tac-8:
    - ``e2e_server_port`` / ``e2e_client_port``: Playwright runs a *separate*
      server+client pair (``reuseExistingServer: false``), so concurrent E2E runs
      need their own ports distinct from the dev pair.
    - ``db_path``: per-worktree SQLite path so concurrent ``better-sqlite3`` file
      locks don't collide.
    """

    adw_id: str
    issue_number: Optional[str] = None
    branch_name: Optional[str] = None
    plan_file: Optional[str] = None
    issue_class: Optional[IssueClassSlashCommand] = None
    worktree_path: Optional[str] = None
    backend_port: Optional[int] = None
    frontend_port: Optional[int] = None
    e2e_server_port: Optional[int] = None
    e2e_client_port: Optional[int] = None
    db_path: Optional[str] = None
    model_set: Optional[ModelSet] = "base"  # Default to "base" model set
    all_adws: List[str] = Field(default_factory=list)


class ReviewIssue(BaseModel):
    """Individual review issue found during spec verification."""

    review_issue_number: int
    screenshot_path: str
    screenshot_url: Optional[str] = None
    issue_description: str
    issue_resolution: str
    issue_severity: Literal["skippable", "tech_debt", "blocker"]


class ReviewResult(BaseModel):
    """Result from reviewing implementation against specification."""

    success: bool
    review_summary: str
    review_issues: List[ReviewIssue] = []
    screenshots: List[str] = []
    screenshot_urls: List[str] = []


class DocumentationResult(BaseModel):
    """Result from documentation generation workflow."""

    success: bool
    documentation_created: bool
    documentation_path: Optional[str] = None
    error_message: Optional[str] = None


class ADWExtractionResult(BaseModel):
    """Result from extracting ADW information from text."""

    workflow_command: Optional[str] = None  # e.g. "adw_plan" (without slash)
    adw_id: Optional[str] = None  # 8-character ADW ID
    model_set: Optional[ModelSet] = "base"

    @property
    def has_workflow(self) -> bool:
        """Check if a workflow command was extracted."""
        return self.workflow_command is not None


# ── Copilot review models (zero-touch ship loop) ────────────────────────────


class CopilotComment(BaseModel):
    """A single GitHub Copilot review comment (inline or summary).

    Built from ``gh api`` review/review-comment payloads.
    """

    id: int
    path: Optional[str] = None
    line: Optional[int] = None
    body: str
    commit_id: Optional[str] = None
    # Severity assigned by the keyword pre-filter ("high" | "low" | None).
    keyword_severity: Optional[Literal["high", "low"]] = None


class CopilotResolveResult(BaseModel):
    """Parsed JSON returned by the /resolve_copilot_feedback command."""

    addressed: List[dict] = Field(default_factory=list)
    acknowledged_low: List[dict] = Field(default_factory=list)
    remaining_high: List[dict] = Field(default_factory=list)
    changed_files: List[str] = Field(default_factory=list)


class CheckRun(BaseModel):
    """A required status check on a PR's head commit (from statusCheckRollup)."""

    name: str
    status: Optional[str] = None  # QUEUED | IN_PROGRESS | COMPLETED ...
    conclusion: Optional[str] = None  # SUCCESS | FAILURE | CANCELLED | None
