"""Branch-currency + conflict resolution for the ZTE ship loop (spec 0013).

When an ADW PR goes stale while ``main`` advances (other PRs merging first), the
branch can fall behind or truly conflict. A conflicting PR can't have its merge
ref built by GitHub, so the ``pull_request`` CI never runs and the PR deadlocks —
and a required check added to ``main`` after the branch was cut never runs on the
old branch either.

``sync_pr_branch`` brings the branch current with ``main`` in the worktree: merge
``main`` in, auto-resolve any conflicts via the ``/resolve_conflicts`` agent, and
push. The push produces a fresh head SHA, so ALL PR workflows (including any
newly-required check) re-run — and the ship loop then re-gates on the full
required-check suite before any autonomous merge. Resolution is one-shot; anything
unresolvable aborts the merge and bubbles up so the caller can abort to a human.
"""

import logging
from typing import Optional

from adw_modules import git_ops
from adw_modules.agent import execute_template
from adw_modules.data_types import AgentTemplateRequest
from adw_modules.phase import post

AGENT_MERGER = "branch_sync"
BASE_REF = "origin/main"


def sync_pr_branch(
    adw_id: str,
    issue_number: Optional[str],
    branch_name: str,
    working_dir: str,
    logger: logging.Logger,
    base: str = BASE_REF,
) -> str:
    """Bring the PR branch current with ``base``, auto-resolving conflicts.

    Returns one of:
      ``"current"``      — already up to date; no action taken.
      ``"synced"``       — merged (and resolved if needed) + pushed; new head SHA.
      ``"unresolvable"`` — conflicts the agent couldn't resolve; merge aborted.
      ``"error"``        — a git/push failure.
    """
    base_ref = base.split("/")[-1]  # "origin/main" → fetch "main"
    if not git_ops.fetch_ref(base_ref, cwd=working_dir):
        logger.warning("Could not fetch %s; proceeding with the local ref", base)

    if git_ops.is_up_to_date_with(base, cwd=working_dir):
        return "current"

    status, conflicts = git_ops.merge_base_into_head(base, cwd=working_dir)
    if status == "error":
        logger.error("Merge of %s failed (non-conflict); aborted", base)
        return "error"

    if status == "conflicted":
        post(
            issue_number, adw_id, AGENT_MERGER,
            f"🔀 {len(conflicts)} merge conflict(s) with main; auto-resolving: {', '.join(conflicts)}",
        )
        response = execute_template(
            AgentTemplateRequest(
                agent_name=AGENT_MERGER,
                slash_command="/resolve_conflicts",
                args=[adw_id, ",".join(conflicts)],
                adw_id=adw_id,
                working_dir=working_dir,
            )
        )
        # Verify the agent actually removed every marker before completing the merge.
        if not response.success or git_ops.has_conflict_markers(conflicts, cwd=working_dir):
            git_ops.abort_merge(cwd=working_dir)
            post(issue_number, adw_id, AGENT_MERGER, "❌ Could not auto-resolve conflicts; merge aborted")
            return "unresolvable"
        ok, err = git_ops.complete_merge(cwd=working_dir)
        if not ok:
            git_ops.abort_merge(cwd=working_dir)
            logger.error("Completing merge commit failed: %s", err)
            return "unresolvable"

    # status == "merged" (clean) or conflicts resolved → publish the new head.
    ok, err = git_ops.push_branch(branch_name, cwd=working_dir)
    if not ok:
        logger.error("Push after sync failed: %s", err)
        return "error"
    return "synced"
