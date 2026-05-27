# Spec 0013 — ADW ship: keep PR branches current with main (auto-resolve conflicts)

- **Status:** Implemented (2026-05-27)
- **Branch:** `feat-adw-branch-sync`
- **Location:** `adws/adw_modules/merge_ops.py` (new), `adws/adw_modules/git_ops.py`,
  `adws/adw_ship.py`, `adws/adw_modules/data_types.py`, `adws/adw_modules/agent.py`,
  `.claude/commands/resolve_conflicts.md` (new), `adws/adw_tests/test_merge_ops.py` (new),
  `adws/README.md`
- **Related docs:** `specs/0008-zte-agentic-layer.md` (the ship loop this hardens),
  `specs/0011-adw-ship-only-trigger.md`, `specs/0012-ux-tasks-harness.md` (added the `ux`
  required check that exposed the stale-check deadlock)

## 1. Problem / Objective

ADW opens a PR early, then the ship loop waits for required checks and merges. But `main`
moves while the PR is open (other PRs merge first), and the ship loop handled that poorly:

- `mergeable == "CONFLICTING"` → **immediate `abort_to_human`** (no attempt to recover).
- only `mergeStateStatus == "BEHIND"` → `update_pr_branch` (a clean merge via the gh API).

Two real failures resulted (observed on PRs #28 and #31, both cut from the same older base):

1. **Conflict deadlock.** A conflicting PR can't have its merge ref built by GitHub, so the
   `pull_request` workflows never run — CI shows nothing but the external Cloudflare check, and
   the PR is stuck. The old code just aborted to a human.
2. **Stale required check.** A check added to `main` after the branch was cut (e.g. the new `ux`
   check from spec 0012) never runs on the old branch, so the PR blocks on a check that can never
   report — and if the branch is also conflicting, it never gets updated to acquire the workflow.

Objective: make the ship loop **bring the branch current with `main` and auto-resolve conflicts**,
so stale/conflicting PRs recover autonomously while staying behind the green-CI merge gate.

## 2. Approach & Changes

At the top of each ship iteration, replace the narrow CONFLICTING/BEHIND handling with a single
**branch-sync** step: fetch `origin/main`, merge it into the PR branch in the worktree, auto-resolve
any conflicts, and push. The push creates a fresh head SHA, so **all** PR workflows re-run —
including any newly-required check the old branch lacked — and the loop then re-gates on the full
required-check suite before any autonomous merge.

- **`git_ops.py`** — new plumbing: `fetch_ref`, `is_up_to_date_with` (merge-base ancestor check),
  `merge_base_into_head` (returns `merged` / `conflicted` + files / `error`), `has_conflict_markers`,
  `complete_merge`, `abort_merge`.
- **`merge_ops.py`** (new) — `sync_pr_branch(...)` orchestrates: skip if already current; else merge
  `main`; on conflicts invoke the `/resolve_conflicts` agent, verify every marker is gone, complete
  the merge; push. Returns `current` / `synced` / `unresolvable` / `error`.
- **`/resolve_conflicts`** (new command) — resolves the conflict markers by **preserving both sides'
  intent** (integrating two changes, not picking a winner), with an explicit guardrail to fail rather
  than guess on human-in-the-loop / risk-engine / security logic. Agent edits files only; Python
  completes or aborts the merge.
- **`adw_ship.py`** — on `CONFLICTING` / `BEHIND` / `DIRTY`, call `sync_pr_branch`; `synced` →
  `continue` (re-run checks on the new SHA); `unresolvable`/`error` → `abort_to_human`; `current` →
  proceed to checks. Drops the now-unused `update_pr_branch`.

## 3. Key Decisions & Rationale

- **Auto-resolve conflicts, then re-gate (not abort).** The agent resolves, but nothing merges until
  the **full required-check suite is green** (quality/e2e/docker/CodeQL/ux) on the freshly-pushed SHA.
  That green-CI gate — plus the bounded `--max-ship-iters` loop and the `adw:needs-human` abort on
  unresolvable conflicts or red checks — is the safety net for a vendor-risk app's autonomous merge.
- **Local merge in the worktree, not the gh "Update branch" API.** The gh API only does clean merges;
  a local `git merge` lets us detect and resolve conflicts. The push re-triggers CI uniformly.
- **One-shot resolution per iteration.** If `main` keeps moving or the agent can't resolve, the next
  iteration re-syncs; exhaustion aborts to a human. Keeps the loop simple and bounded.
- **Marker verification before completing the merge.** Python checks the files are marker-free
  (`has_conflict_markers`) and aborts the merge if the agent left anything — the agent never runs
  `git add/commit/merge`.

## 4. Verification

- `uv run adws/adw_tests/test_merge_ops.py` — temp-git-repo tests for up-to-date detection, clean
  merge, conflict detection + abort, and resolve-then-complete (no network, no agent).
- `uv run adws/adw_tests/test_model_selection.py` — confirms `/resolve_conflicts` is in the model map
  and all `SlashCommand` literals are covered.
- `python -m py_compile` + import smoke on `merge_ops` and `adw_ship` (confirms `update_pr_branch`
  removal is clean).
- **End-to-end:** re-run `adws/adw_ship.py 27 acacd206` (or the cron) on the conflicting PR #31 — it
  should merge `main`, auto-resolve the `ReviewWorkspace.tsx` conflict, push, run CI (incl. `ux`), and
  proceed.

## 5. Known Limitations / Follow-ups

- A required check that never runs while the branch is *already current* (not behind/conflicting) is
  not force-retriggered; the common path (branch behind → sync pushes a new SHA) covers the observed
  cases. A future improvement: on a checks timeout with a never-run required check, push to re-trigger.
- Conflict resolution quality depends on the agent; the green-CI gate catches functional breakage but
  not every subtle semantic merge error — hence the explicit "fail rather than guess" guardrail on
  risk/approval logic in `/resolve_conflicts`.
