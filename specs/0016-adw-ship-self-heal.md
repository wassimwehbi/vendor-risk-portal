# Spec 0016 — ADW ship: self-heal a head commit that never triggered CI + auto-resolve binary conflicts

- **Status:** Implemented (2026-05-27)
- **Branch:** `fix/adw-ship-self-heal`
- **Location:** `adws/adw_modules/ship_ops.py`, `adws/adw_ship.py`,
  `adws/adw_modules/merge_ops.py`, `adws/adw_modules/git_ops.py`,
  `adws/adw_tests/test_ship_ops.py` (new), `adws/adw_tests/test_merge_ops.py`
- **Related docs:** `specs/0008-zte-agentic-layer.md` (the ship loop this hardens),
  `specs/0013-adw-branch-sync.md` (branch-currency / conflict resolution this extends),
  `specs/0012-ux-tasks-harness.md` (the `ux` baseline screenshots that produce binary conflicts)

## 1. Problem / Objective

Issue #43 (PR #57) completed plan→build→test→review→document cleanly, but the zero-touch
ship phase could not finish it. Two distinct gaps in the ship loop were exposed:

1. **A head commit that never triggered CI deadlocks the wait.** The `document` phase added a
   final commit (`d699fa4`) that became the PR head. GitHub ran the PR workflows on the
   *previous* commit (`f11107f`, all required checks green) but **not** on the new head — only
   the Cloudflare and Copilot checks appeared there. `ship_ops.evaluate_checks` treated a
   required check with *no run at all* on the head SHA (`r is None`) identically to one that is
   *still running* — both `pending`. So `wait_for_required_checks` polled the full
   `--checks-timeout` (45 min) for checks that would never appear, then aborted with
   *"required checks did not complete in time."* The only CI re-trigger that existed
   (`merge_ops.sync_pr_branch`, spec 0013) fires **only** when the branch is `BEHIND`/`DIRTY`/
   `CONFLICTING` — not when it is clean and current but the head simply never kicked CI.

2. **Binary conflicts can't be auto-resolved.** Once `main` advanced (PRs #55/#56 plus an
   earlier baseline regen), PR #57 conflicted with `main` on a **binary** file —
   `e2e/screenshots/admin_delete_after.png`. `sync_pr_branch` routed it to the text-based
   `/resolve_conflicts` agent and verified resolution with `has_conflict_markers`, which scans
   for `<<<<<<<` text markers. A binary conflict carries **no** such markers, so the check is
   blind to it and the agent can't merge two PNGs anyway — the sync either spins or aborts.

Objective: make the ship loop (a) detect a head commit whose required checks never started and
re-trigger CI, and (b) resolve binary conflicts deterministically instead of handing them to a
text agent — so PRs like #57 ship autonomously while staying behind the green-CI merge gate.

## 2. Approach & Changes

### 2.1 Distinguish "missing" from "pending", then re-trigger CI

`ship_ops.evaluate_checks` now classifies into four states with priority
**failing > pending > missing > green**:

- `failing` — ≥1 required check concluded red.
- `pending` — ≥1 required check is actively running (`QUEUED`/`IN_PROGRESS`, or `CANCELLED` —
  superseded under `cancel-in-progress`). A check that is merely *absent* is **not** actionable
  while something is still running, because a freshly-pushed head registers its runs over a few
  seconds during which checks are transiently absent.
- `missing` — nothing is running, yet ≥1 required check has **no run at all** on the head SHA.
- `green` — every required check succeeded (or was neutral/skipped).

`wait_for_required_checks` returns the new `missing` result only after the checks have stayed
absent-with-nothing-running for `missing_grace_sec` (default **120 s**) — CI registers runs within
seconds of a push, so sustained silence means the push never triggered it. The ship loop
(`adw_ship.py`) handles `missing` by minting a **fresh head SHA via an empty commit**
(`git_ops.commit_empty` → `push_branch`), which fires `pull_request: synchronize` so the workflows
re-run. The squash-merge later discards the empty commit, so it never lands on `main`. This is
bounded by `--max-retriggers` (default **2**); exhausting it aborts to a human with a precise
reason rather than spinning or burning the timeout.

### 2.2 Resolve binary conflicts in favor of main

`merge_ops.sync_pr_branch` now partitions the conflicted files into **binary** (detected by
`git_ops.is_binary_path` — a NUL byte in the first 8 KiB, git's own heuristic) and **text**.
Binary conflicts are resolved with `git_ops.resolve_take_theirs` (`git checkout --theirs` + `git
add`), taking **main's** version; only the remaining text conflicts go to the `/resolve_conflicts`
agent. `main` is the integration source of truth (spec 0012 baselines are Linux-CI-generated), and
the re-run `ux` check re-validates — so a wrong pick on a genuine UI change goes red and
self-corrects to a human, while a non-UI PR (like #43, server-only) gets exactly the right result.

## 3. Key decisions & rationale

- **Empty commit, not force-push.** Minting a new head with `git commit --allow-empty` is simpler
  and safer than `--amend` + force-push, and the squash-merge erases it from `main`'s history.
- **Grace window before declaring "missing".** Without it, the very first poll after a push (when
  no runs have registered yet) would be misread as missing and trigger a needless re-push. 120 s of
  total silence is well beyond CI's normal seconds-to-register latency.
- **`in_progress` outranks `missing`.** If any required check is running, we keep waiting even
  though others are absent — they are likely still registering. Only a fully quiescent head with
  absent checks is actionable.
- **Binary → take theirs (main).** Binary merges are unrepresentable to a text agent. Defaulting to
  main keeps the source-of-truth baseline and leans on the existing `ux` gate as the safety net,
  preserving autonomy without risking a silently-wrong baseline (per the design decision recorded
  for this change).
- **Bounded re-triggers.** A genuinely broken trigger (vs. a one-off dropped event) must not loop;
  `--max-retriggers` caps attempts and then escalates to a human.

## 4. Verification

- `uv run adws/adw_tests/test_ship_ops.py` (new, 11 cases): `evaluate_checks` green / failing /
  missing / pending classification, `in_progress`-beats-`missing`, `failing`-beats-`missing`,
  `CANCELLED`→pending; `wait_for_required_checks` returns `missing` after grace, plus green /
  failing / timeout via a stubbed status fetch (no network).
- `uv run adws/adw_tests/test_merge_ops.py` (extended, 7 cases): `is_binary_path` detection and a
  full binary-conflict flow — conflict detected, no text markers, `resolve_take_theirs` yields
  main's bytes, `complete_merge` succeeds, branch now contains `main`.
- `uv run adws/adw_tests/test_ux_validation.py` and `test_ship_only.py` still pass (unchanged
  `ship_ops` public API: `DEFAULT_REQUIRED_CHECKS`, `UX_CHECK_NAME`, `required_checks`).

## 5. Known limitations / follow-ups

- **Why the documenter push dropped its `synchronize` event** was not root-caused at the GitHub
  side (the `ADW_GH_TOKEN` PAT setup is correct and fired for the prior three pushes). The fix is
  defensive: it recovers regardless of cause. If drops recur, investigate the `document`-phase push
  path for a token/race difference.
- **`is_binary_path` reads the working-tree file** (the conflict's "ours" side). A text file
  containing a NUL byte would be misclassified as binary; this is vanishingly rare for source and
  acceptable given the `ux`/CI gates downstream.
- **Binary "take theirs" is unconditional.** It always prefers `main`. If a PR legitimately needs to
  *advance* a binary baseline, it must land that change via the sanctioned `update-baselines`
  workflow (spec 0012) rather than a hand-edited file on a feature branch.
