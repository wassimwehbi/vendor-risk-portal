"""GitHub Copilot feedback classification + resolution for the ship loop.

Copilot's review payload carries no numeric severity, so we use a two-tier
signal: a keyword pre-filter (which can only *raise* importance for security/bug
language, never downgrade it) combined with the LLM judgment in the
/resolve_copilot_feedback command.
"""

import json
import logging
from typing import List, Optional

from adw_modules.agent import execute_template
from adw_modules.data_types import (
    AgentTemplateRequest,
    CopilotComment,
    CopilotResolveResult,
)
from adw_modules.utils import parse_json

# Language that marks a comment as high-importance (correctness / security).
HIGH_KEYWORDS = [
    "bug", "security", "vulnerab", "injection", "crash", "data loss",
    "race", "leak", "incorrect", " must ", "null", "undefined", "npe",
    "authz", "authoriz", "secret", "pii", "regression", "breaks", "broken",
    "overflow", "deadlock", "unsafe", "exploit", "csrf", "xss",
]
# Language that marks a comment as low-importance (cosmetic).
LOW_KEYWORDS = [
    "nit", "style", "typo", "consider", "optional", "prefer",
    "readability", "naming", "minor", "cosmetic", "wording",
]


def keyword_severity(body: str) -> Optional[str]:
    """Classify a comment body as 'high', 'low', or None (defer to the LLM)."""
    b = (body or "").lower()
    if any(k in b for k in HIGH_KEYWORDS):
        return "high"
    if any(k in b for k in LOW_KEYWORDS):
        return "low"
    return None


def classify(comments: List[CopilotComment]) -> List[CopilotComment]:
    for c in comments:
        c.keyword_severity = keyword_severity(c.body)
    return comments


def actionable(comments: List[CopilotComment]) -> List[CopilotComment]:
    """Comments worth sending to the resolver: high-keyword or undetermined."""
    return [c for c in comments if c.keyword_severity in ("high", None)]


def resolve_copilot_feedback(
    adw_id: str,
    pr_number: str,
    comments: List[CopilotComment],
    working_dir: str,
    logger: logging.Logger,
) -> Optional[CopilotResolveResult]:
    """Run /resolve_copilot_feedback and parse its structured result."""
    payload = json.dumps([c.model_dump() for c in comments])
    response = execute_template(
        AgentTemplateRequest(
            agent_name="copilot_resolver",
            slash_command="/resolve_copilot_feedback",
            args=[adw_id, str(pr_number), payload],
            adw_id=adw_id,
            working_dir=working_dir,
        )
    )
    if not response.success:
        logger.error(f"resolve_copilot_feedback failed: {response.output}")
        return None
    try:
        return parse_json(response.output, CopilotResolveResult)
    except Exception as e:
        logger.error(f"Could not parse resolve result: {e}")
        return None
