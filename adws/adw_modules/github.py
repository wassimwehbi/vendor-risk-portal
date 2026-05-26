"""GitHub operations for the ADW system.

Includes PR-status and GitHub Copilot review helpers used by the zero-touch ship
loop (adw_ship.py).
"""

import subprocess
import sys
import os
import json
from typing import Dict, List, Optional
from adw_modules.data_types import (
    GitHubIssue,
    GitHubIssueListItem,
    GitHubComment,
    CopilotComment,
    CheckRun,
)

# Bot identifier used to prevent trigger loops and filter bot comments.
ADW_BOT_IDENTIFIER = "[ADW-AGENTS]"

# Login fragments that identify GitHub Copilot's review bot.
_COPILOT_LOGIN_FRAGMENTS = ("copilot",)


def get_github_env() -> Optional[dict]:
    """Return the environment with GH_TOKEN set, or None to inherit ambient gh auth.

    Inherits the full environment (HOME, XDG_*, SSL cert vars, …) rather than a
    minimal dict, since `gh`/`git` need those; we only overlay the token.
    """
    token = os.getenv("GITHUB_PAT") or os.getenv("GH_TOKEN")
    if not token:
        return None
    env = os.environ.copy()
    env["GH_TOKEN"] = token
    return env


def get_repo_url() -> str:
    """Get the GitHub repository URL from the git remote."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        raise ValueError(
            "No git remote 'origin' found. Ensure you're in a git repo with a remote."
        )
    except FileNotFoundError:
        raise ValueError("git command not found. Ensure git is installed.")


def extract_repo_path(github_url: str) -> str:
    """Extract owner/repo from a GitHub URL."""
    return (
        github_url.replace("https://github.com/", "")
        .replace("git@github.com:", "")
        .replace(".git", "")
        .strip("/")
    )


def repo_path() -> str:
    """Convenience: owner/repo for the current origin remote."""
    return extract_repo_path(get_repo_url())


def fetch_issue(issue_number: str, repo: str) -> GitHubIssue:
    """Fetch a GitHub issue via gh CLI and return a typed model."""
    cmd = [
        "gh",
        "issue",
        "view",
        str(issue_number),
        "-R",
        repo,
        "--json",
        "number,title,body,state,author,assignees,labels,milestone,comments,createdAt,updatedAt,closedAt,url",
    ]
    env = get_github_env()
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if result.returncode == 0:
            return GitHubIssue(**json.loads(result.stdout))
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)
    except FileNotFoundError:
        print("Error: GitHub CLI (gh) is not installed.", file=sys.stderr)
        print("Install: brew install gh, then `gh auth login`.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error parsing issue data: {e}", file=sys.stderr)
        sys.exit(1)


def make_issue_comment(issue_id: str, comment: str) -> None:
    """Post a comment to a GitHub issue, tagged with ADW_BOT_IDENTIFIER."""
    repo = repo_path()
    if not comment.startswith(ADW_BOT_IDENTIFIER):
        comment = f"{ADW_BOT_IDENTIFIER} {comment}"

    cmd = ["gh", "issue", "comment", str(issue_id), "-R", repo, "--body", comment]
    env = get_github_env()
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if result.returncode == 0:
            print(f"Successfully posted comment to issue #{issue_id}")
        else:
            print(f"Error posting comment: {result.stderr}", file=sys.stderr)
            raise RuntimeError(f"Failed to post comment: {result.stderr}")
    except Exception as e:
        print(f"Error posting comment: {e}", file=sys.stderr)
        raise


def add_issue_label(issue_id: str, label: str) -> None:
    """Best-effort add a label to an issue (label may not exist)."""
    repo = repo_path()
    env = get_github_env()
    result = subprocess.run(
        ["gh", "issue", "edit", str(issue_id), "-R", repo, "--add-label", label],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        print(f"Note: could not add label '{label}': {result.stderr}")


def add_pr_label(pr_number: str, label: str) -> None:
    """Best-effort add a label to a PR."""
    repo = repo_path()
    env = get_github_env()
    result = subprocess.run(
        ["gh", "pr", "edit", str(pr_number), "-R", repo, "--add-label", label],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        print(f"Note: could not add PR label '{label}': {result.stderr}")


def fetch_open_issues(repo: str) -> List[GitHubIssueListItem]:
    """Fetch all open issues from the repository."""
    try:
        cmd = [
            "gh",
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "open",
            "--json",
            "number,title,body,labels,createdAt,updatedAt",
            "--limit",
            "1000",
        ]
        env = get_github_env()
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env)
        issues = [GitHubIssueListItem(**d) for d in json.loads(result.stdout)]
        print(f"Fetched {len(issues)} open issues")
        return issues
    except subprocess.CalledProcessError as e:
        print(f"ERROR: Failed to fetch issues: {e.stderr}", file=sys.stderr)
        return []
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse issues JSON: {e}", file=sys.stderr)
        return []


def fetch_issue_comments(repo: str, issue_number: int) -> List[Dict]:
    """Fetch all comments for an issue, sorted oldest-first."""
    try:
        cmd = [
            "gh",
            "issue",
            "view",
            str(issue_number),
            "--repo",
            repo,
            "--json",
            "comments",
        ]
        env = get_github_env()
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env)
        comments = json.loads(result.stdout).get("comments", [])
        comments.sort(key=lambda c: c.get("createdAt", ""))
        return comments
    except subprocess.CalledProcessError as e:
        print(f"ERROR: comments for #{issue_number}: {e.stderr}", file=sys.stderr)
        return []
    except json.JSONDecodeError as e:
        print(f"ERROR: parse comments for #{issue_number}: {e}", file=sys.stderr)
        return []


def find_keyword_from_comment(
    keyword: str, issue: GitHubIssue
) -> Optional[GitHubComment]:
    """Find the latest non-bot comment containing a keyword (newest first)."""
    sorted_comments = sorted(issue.comments, key=lambda c: c.created_at, reverse=True)
    for comment in sorted_comments:
        if ADW_BOT_IDENTIFIER in comment.body:
            continue
        if keyword in comment.body:
            return comment
    return None


# ── PR status + Copilot review helpers (zero-touch ship loop) ───────────────


def _gh_api(args: List[str]) -> Optional[object]:
    """Run `gh api` with the given args; return parsed JSON or None on failure."""
    env = get_github_env()
    result = subprocess.run(
        ["gh", "api", *args], capture_output=True, text=True, env=env
    )
    if result.returncode != 0:
        print(f"gh api failed ({' '.join(args)}): {result.stderr.strip()}", file=sys.stderr)
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def get_pr_head_sha(pr_number: str, repo: Optional[str] = None) -> Optional[str]:
    """Return the head commit SHA of a PR."""
    repo = repo or repo_path()
    env = get_github_env()
    result = subprocess.run(
        ["gh", "pr", "view", str(pr_number), "-R", repo, "--json", "headRefOid"],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout).get("headRefOid")
    except json.JSONDecodeError:
        return None


def get_required_check_runs(
    pr_number: str, required_names: List[str], repo: Optional[str] = None
) -> List[CheckRun]:
    """Return the status of the required checks on a PR's head commit.

    Normalizes both statusCheckRollup shapes: CheckRun (name/status/conclusion)
    and StatusContext (context/state).
    """
    repo = repo or repo_path()
    env = get_github_env()
    result = subprocess.run(
        ["gh", "pr", "view", str(pr_number), "-R", repo, "--json", "statusCheckRollup"],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        return []
    try:
        rollup = json.loads(result.stdout).get("statusCheckRollup", []) or []
    except json.JSONDecodeError:
        return []

    runs: List[CheckRun] = []
    for item in rollup:
        if "name" in item:  # CheckRun
            name = item.get("name")
            status = item.get("status")
            conclusion = item.get("conclusion")
        else:  # StatusContext (state: SUCCESS/PENDING/FAILURE/ERROR)
            name = item.get("context")
            state = (item.get("state") or "").upper()
            status = "COMPLETED" if state not in ("PENDING", "") else "IN_PROGRESS"
            conclusion = state if state not in ("PENDING", "") else None
        if name in required_names:
            runs.append(CheckRun(name=name, status=status, conclusion=conclusion))
    return runs


def fetch_copilot_comments(
    pr_number: str, repo: Optional[str] = None
) -> List[CopilotComment]:
    """Fetch Copilot's PR review comments (inline) + review summaries.

    Returns CopilotComment objects with the GitHub comment id, file path, line,
    body, and the commit the comment is anchored to.
    """
    repo = repo or repo_path()
    out: List[CopilotComment] = []

    def is_copilot(user: dict) -> bool:
        login = (user or {}).get("login", "").lower()
        utype = (user or {}).get("type", "")
        return any(f in login for f in _COPILOT_LOGIN_FRAGMENTS) and (
            utype == "Bot" or "copilot" in login
        )

    # Inline review comments
    comments = _gh_api(
        ["--paginate", f"repos/{repo}/pulls/{pr_number}/comments"]
    ) or []
    for c in comments:
        if is_copilot(c.get("user", {})):
            out.append(
                CopilotComment(
                    id=c.get("id"),
                    path=c.get("path"),
                    line=c.get("line") or c.get("original_line"),
                    body=c.get("body", ""),
                    commit_id=c.get("commit_id") or c.get("original_commit_id"),
                )
            )

    # Review summaries (top-level reviews with a non-empty body)
    reviews = _gh_api(["--paginate", f"repos/{repo}/pulls/{pr_number}/reviews"]) or []
    for r in reviews:
        if is_copilot(r.get("user", {})) and (r.get("body") or "").strip():
            out.append(
                CopilotComment(
                    id=r.get("id"),
                    path=None,
                    line=None,
                    body=r.get("body", ""),
                    commit_id=r.get("commit_id"),
                )
            )
    return out


def request_copilot_review(pr_number: str, repo: Optional[str] = None) -> bool:
    """Best-effort re-request a Copilot review on the PR's latest commit.

    The repo's Copilot ruleset typically re-requests automatically on push; this
    is belt-and-suspenders. Failures are non-fatal.
    """
    repo = repo or repo_path()
    env = get_github_env()
    result = subprocess.run(
        [
            "gh",
            "api",
            "-X",
            "POST",
            f"repos/{repo}/pulls/{pr_number}/requested_reviewers",
            "-f",
            "reviewers[]=Copilot",
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        print(f"Note: could not re-request Copilot review: {result.stderr.strip()}")
        return False
    return True


def update_pr_branch(pr_number: str, repo: Optional[str] = None) -> bool:
    """Update a PR's branch with its base (required when protection is strict)."""
    repo = repo or repo_path()
    env = get_github_env()
    result = subprocess.run(
        [
            "gh",
            "api",
            "--method",
            "PUT",
            f"repos/{repo}/pulls/{pr_number}/update-branch",
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    # 202 Accepted is success; "merge conflict" / "up to date" are benign here.
    if result.returncode != 0:
        msg = result.stderr.strip()
        if "up to date" in msg.lower() or "up-to-date" in msg.lower():
            return True
        print(f"Note: update-branch returned: {msg}")
        return False
    return True
