"""Git operations for the ADW composable architecture.

Builds on github.py. Includes an extended merge helper for the zero-touch ship
loop (squash + delete-branch, optional admin bypass) and a PR state reader.
"""

import subprocess
import json
import logging
import os
from typing import List, Optional, Tuple

from adw_modules.github import (
    get_repo_url,
    extract_repo_path,
    make_issue_comment,
    get_github_env,
)


def get_current_branch(cwd: Optional[str] = None) -> str:
    """Get the current git branch name."""
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    return result.stdout.strip()


def push_branch(branch_name: str, cwd: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Push the current branch to origin. Returns (success, error)."""
    result = subprocess.run(
        ["git", "push", "-u", "origin", branch_name],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if result.returncode != 0:
        return False, result.stderr
    return True, None


# ── Branch-currency + conflict resolution (ship loop, spec 0013) ────────────


def fetch_ref(ref: str = "main", cwd: Optional[str] = None) -> bool:
    """`git fetch origin <ref>`. Returns success."""
    r = subprocess.run(["git", "fetch", "origin", ref], capture_output=True, text=True, cwd=cwd)
    return r.returncode == 0


def is_up_to_date_with(base: str, cwd: Optional[str] = None) -> bool:
    """True if `base` is already an ancestor of HEAD (branch contains base)."""
    r = subprocess.run(
        ["git", "merge-base", "--is-ancestor", base, "HEAD"], capture_output=True, text=True, cwd=cwd
    )
    return r.returncode == 0


def merge_base_into_head(base: str, cwd: Optional[str] = None) -> Tuple[str, List[str]]:
    """Merge `base` into the current branch (no commit message edit).

    Returns (status, conflicted_files):
      'merged'     — clean merge (already committed by git); no conflicts.
      'conflicted' — merge stopped with conflicts; caller resolves then completes.
      'error'      — merge failed for a non-conflict reason; merge has been aborted.
    """
    m = subprocess.run(["git", "merge", "--no-edit", base], capture_output=True, text=True, cwd=cwd)
    if m.returncode == 0:
        return "merged", []
    conflicts = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=U"], capture_output=True, text=True, cwd=cwd
    ).stdout.split()
    if conflicts:
        return "conflicted", conflicts
    subprocess.run(["git", "merge", "--abort"], capture_output=True, text=True, cwd=cwd)
    return "error", []


def has_conflict_markers(files: List[str], cwd: Optional[str] = None) -> bool:
    """True if any of `files` still contains git conflict markers."""
    root = cwd or "."
    for rel in files:
        try:
            with open(os.path.join(root, rel), "r", encoding="utf-8", errors="ignore") as fh:
                text = fh.read()
        except OSError:
            continue
        if "<<<<<<<" in text or ">>>>>>>" in text or "\n=======\n" in text:
            return True
    return False


def complete_merge(cwd: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Stage everything and commit the in-progress merge (default merge message)."""
    subprocess.run(["git", "add", "-A"], capture_output=True, text=True, cwd=cwd)
    r = subprocess.run(["git", "commit", "--no-edit"], capture_output=True, text=True, cwd=cwd)
    if r.returncode != 0:
        return False, r.stderr
    return True, None


def abort_merge(cwd: Optional[str] = None) -> None:
    """Abort an in-progress merge, restoring the pre-merge state. Best-effort."""
    subprocess.run(["git", "merge", "--abort"], capture_output=True, text=True, cwd=cwd)


def check_pr_exists(branch_name: str) -> Optional[str]:
    """Return the PR URL for a branch if an open PR exists."""
    try:
        repo = extract_repo_path(get_repo_url())
    except Exception:
        return None
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", repo, "--head", branch_name, "--state", "open",
         "--json", "url"],
        capture_output=True,
        text=True,
        env=get_github_env(),
    )
    if result.returncode == 0:
        prs = json.loads(result.stdout)
        if prs:
            return prs[0]["url"]
    return None


def create_branch(branch_name: str, cwd: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Create and checkout a new branch (checkout existing if present)."""
    result = subprocess.run(
        ["git", "checkout", "-b", branch_name], capture_output=True, text=True, cwd=cwd
    )
    if result.returncode != 0:
        if "already exists" in result.stderr:
            result = subprocess.run(
                ["git", "checkout", branch_name], capture_output=True, text=True, cwd=cwd
            )
            if result.returncode != 0:
                return False, result.stderr
            return True, None
        return False, result.stderr
    return True, None


def commit_changes(message: str, cwd: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Stage all changes and commit. No-op if nothing to commit."""
    result = subprocess.run(
        ["git", "status", "--porcelain"], capture_output=True, text=True, cwd=cwd
    )
    if not result.stdout.strip():
        return True, None

    result = subprocess.run(["git", "add", "-A"], capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        return False, result.stderr

    result = subprocess.run(
        ["git", "commit", "-m", message], capture_output=True, text=True, cwd=cwd
    )
    if result.returncode != 0:
        return False, result.stderr
    return True, None


def get_pr_number(branch_name: str) -> Optional[str]:
    """Get the PR number for a branch, if an open PR exists."""
    try:
        repo = extract_repo_path(get_repo_url())
    except Exception:
        return None
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", repo, "--head", branch_name, "--state", "open",
         "--json", "number", "--limit", "1"],
        capture_output=True,
        text=True,
        env=get_github_env(),
    )
    if result.returncode == 0:
        prs = json.loads(result.stdout)
        if prs:
            return str(prs[0]["number"])
    return None


def filter_adw_pr_branches(prs: list, issue_number) -> list:
    """From `gh pr list --json number,headRefName` output, return [(branch, number)]
    for PRs whose head follows the ADW branch convention for this issue.

    Matches the `<class>-issue-<n>-adw-...` token (not any branch that merely
    mentions the number) to avoid false positives on human PRs.
    """
    token = f"-issue-{issue_number}-adw-"
    return [
        (pr.get("headRefName", ""), str(pr.get("number")))
        for pr in prs
        if token in pr.get("headRefName", "")
    ]


def find_open_pr_branch_for_issue(issue_number) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Find the single open ADW PR for an issue. Returns (branch, pr_number, error)."""
    try:
        repo = extract_repo_path(get_repo_url())
    except Exception as e:  # noqa: BLE001
        return None, None, f"could not resolve repo: {e}"
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", repo, "--state", "open", "--limit", "200",
         "--json", "number,headRefName"],
        capture_output=True,
        text=True,
        env=get_github_env(),
    )
    if result.returncode != 0:
        return None, None, f"gh pr list failed: {result.stderr.strip()}"
    try:
        prs = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None, None, "could not parse gh pr list output"
    matches = filter_adw_pr_branches(prs, issue_number)
    if not matches:
        return None, None, f"no open ADW PR found for issue #{issue_number}"
    if len(matches) > 1:
        branches = ", ".join(b for b, _ in matches)
        return None, None, f"multiple open ADW PRs for issue #{issue_number}: {branches}"
    branch, number = matches[0]
    return branch, number, None


def get_pr_state(pr_number: str) -> Optional[dict]:
    """Return {merged, mergeable, mergeStateStatus, state} for a PR."""
    try:
        repo = extract_repo_path(get_repo_url())
    except Exception:
        return None
    result = subprocess.run(
        ["gh", "pr", "view", str(pr_number), "--repo", repo, "--json",
         "merged,mergeable,mergeStateStatus,state"],
        capture_output=True,
        text=True,
        env=get_github_env(),
    )
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def merge_pr(
    pr_number: str,
    logger: logging.Logger,
    merge_method: str = "squash",
    delete_branch: bool = True,
    admin: bool = False,
) -> Tuple[bool, Optional[str]]:
    """Merge a PR. Returns (success, error).

    Args:
        merge_method: 'merge' | 'squash' | 'rebase'
        delete_branch: pass --delete-branch
        admin: pass --admin (bypass the human-approval gate only; never used to
            bypass failing required checks).
    """
    try:
        repo = extract_repo_path(get_repo_url())
    except Exception as e:
        return False, f"Failed to get repo info: {e}"

    cmd = ["gh", "pr", "merge", str(pr_number), "--repo", repo, f"--{merge_method}"]
    if delete_branch:
        cmd.append("--delete-branch")
    if admin:
        cmd.append("--admin")
    cmd.extend(["--body", "Merged by ADW zero-touch ship after green checks + Copilot clean."])

    result = subprocess.run(cmd, capture_output=True, text=True, env=get_github_env())
    if result.returncode != 0:
        return False, result.stderr
    logger.info(f"Merged PR #{pr_number} using {merge_method} (admin={admin})")
    return True, None


def finalize_git_operations(
    state, logger: logging.Logger, cwd: Optional[str] = None
) -> None:
    """Standard git finalization: push the branch and create/update the PR."""
    branch_name = state.get("branch_name")
    if not branch_name:
        current_branch = get_current_branch(cwd=cwd)
        if current_branch and current_branch != "main":
            logger.warning(f"No branch in state, using current: {current_branch}")
            branch_name = current_branch
        else:
            logger.error("No branch in state and current is main; skipping git ops")
            return

    success, error = push_branch(branch_name, cwd=cwd)
    if not success:
        logger.error(f"Failed to push branch: {error}")
        return
    logger.info(f"Pushed branch: {branch_name}")

    pr_url = check_pr_exists(branch_name)
    issue_number = state.get("issue_number")
    adw_id = state.get("adw_id")

    if pr_url:
        logger.info(f"Found existing PR: {pr_url}")
        if issue_number and adw_id:
            make_issue_comment(issue_number, f"{adw_id}_ops: ✅ Pull request: {pr_url}")
        return

    if not issue_number:
        logger.error("No issue number in state; cannot create PR")
        return

    try:
        repo = extract_repo_path(get_repo_url())
        from adw_modules.github import fetch_issue
        from adw_modules.workflow_ops import create_pull_request

        issue = fetch_issue(issue_number, repo)
        pr_url, error = create_pull_request(branch_name, issue, state, logger, cwd)
    except Exception as e:
        logger.error(f"Failed to create PR: {e}")
        pr_url, error = None, str(e)

    if pr_url:
        logger.info(f"Created PR: {pr_url}")
        if issue_number and adw_id:
            make_issue_comment(issue_number, f"{adw_id}_ops: ✅ Pull request created: {pr_url}")
    else:
        logger.error(f"Failed to create PR: {error}")
