# Spec 0011 — ADW `adw:ship`: ship-only trigger for an existing PR

- **Status:** Implemented (2026-05-27)
- **Branch:** `claude/open-prs-status-UDH9K`
- **Location:** `adws/adw_ship_zte.py` (new), `adws/adw_triggers/run_zte.py`,
  `adws/adw_triggers/trigger_cron.py`, `adws/adw_modules/git_ops.py`,
  `adws/adw_modules/workflow_ops.py`, `adws/adw_modules/worktree_ops.py`,
  `.github/workflows/adw-zte.yml`, `adws/adw_tests/test_ship_only.py` (new)
- **Related docs:** `specs/0008-zte-agentic-layer.md` (the full ZTE pipeline this
  extends), `adws/README.md`

## 1. Problem / Objective

The `adw:ship` label was a dead alias for `adw:zte`: both sat in the cron
poller's trigger set, the poller discarded which label fired, and every run went
through the full 6-phase pipeline (`adw_sdlc_zte.py`). Worse, the poller's guard
`if has_open_adw_pr(...): return False` skipped a run precisely when a PR already
existed — the exact precondition a "just ship it" run needs.

Objective: labeling an issue `adw:ship` should **skip ahead** — find the issue's
existing open PR and run only the ship phase (`adw_ship.py`: wait for the
required checks, auto-fix `quality`/`e2e`, resolve Copilot, squash-merge). This
must work from both trigger surfaces: the cron poller and the GitHub Actions
workflow.

The crux: `adw_ship.py` is strictly dependent — it loads `adw_state.json`,
requires a `branch_name`, and runs in the state's working dir. A ship-only run
starts with only an issue number, so the state + branch + working dir must be
reconstructed from the open PR before `adw_ship.py` can run. `adw_ship.py` itself
is unchanged.

## 2. Approach & Changes

**New entry script — `adws/adw_ship_zte.py`.** A thin ship-only entry (mirrors
`adw_sdlc_zte.py`): honors the `ADW_DISABLED` kill-switch, parses the ship flags
(`--dry-run`/`--admin`/`--no-copilot`/`--max-ship-iters`/`--checks-timeout`),
calls `bootstrap_ship_only_state(...)`, and on success runs a single-phase
pipeline `[("adw_ship.py", ship_args, True)]` via the existing `run_pipeline`.
On a bootstrap error it posts a `🛑 Needs human attention` issue comment and
exits non-zero.

**Bootstrap — `bootstrap_ship_only_state(issue_number, logger)`** in
`workflow_ops.py` (the only genuinely new behavior). It:
1. finds the issue's single open ADW PR via the new
   `git_ops.find_open_pr_branch_for_issue` (built on the new pure helper
   `filter_adw_pr_branches`, matching the `-issue-<n>-adw-` convention);
2. recovers the **original** adw_id from the branch via the new
   `workflow_ops.adw_id_from_branch` (regex `-adw-([A-Za-z0-9]+)-`);
3. materializes `ADWState` (`issue_number`, `branch_name`);
4. checks out the branch — in CI (`ADW_IN_CI=true`) in place at the repo root
   (`git fetch` + `git checkout`, no worktree); locally it allocates ports,
   attaches a worktree to the existing branch via the new
   `worktree_ops.attach_worktree_to_branch`, then runs the same
   `/install_worktree` step `adw_plan.py` uses so the ship loop can self-heal a
   failing check locally.

**Trigger routing.** `run_zte.py` now routes on `--ship-only`: with it, it runs
`adw_ship_zte.py`; otherwise `adw_sdlc_zte.py` (single stable entry for both
triggers). The cron poller's `qualifies()` returns a `mode ∈ {None,"zte","ship"}`
and **inverts the open-PR guard per mode** — `zte` skips when a PR exists,
`ship` skips when none exists; `launch()` appends `--ship-only` for ship mode and
passes no positional adw_id (the bootstrap recovers it). `adw-zte.yml` fires on
`adw:ship`, computes a `ship_only` step output (true when the issue carries the
`adw:ship` label), and appends `--ship-only` to the run command.

## 3. Key Decisions & Rationale

- **New `adw_ship_zte.py` script** rather than a `--ship-only` flag on
  `adw_sdlc_zte.py`: keeps `adw_ship.py`'s "needs state" contract and the full
  pipeline entry point untouched, and reads clearly at the call sites.
- **Both triggers wired.** The Actions `labeled` event is the label-native path
  (fires instantly, no comment de-dup); the cron poller covers local/self-hosted
  polling.
- **`adw:ship` wins over `adw:zte`** when both are present — the more specific
  intent ("ship the existing PR") takes precedence.
- **adw_id recovered from the PR branch**, not freshly minted, so the state path,
  worktree, ports, and issue-comment thread align with the original run.
- **Full worktree install locally** (not a lightweight attach) so the ship loop's
  `quality`/`e2e` auto-fix can run tests in the working copy and still merge —
  preserving true zero-touch shipping.

## 4. Verification

- **Unit tests** (`uv run adws/adw_tests/test_ship_only.py`, all pass):
  `adw_id_from_branch` parsing; `filter_adw_pr_branches` single/zero/multi and
  no false substring match; `qualifies()` guard inversion across the
  `ship`/`zte` × PR-open/absent matrix; `adw:ship` precedence; freeze kill-switch.
- **Regression:** `uv run adws/adw_tests/test_model_selection.py` still passes;
  `adw:zte` still runs all 6 phases.
- **Static:** all changed Python byte-compiles and imports cleanly; `adw-zte.yml`
  validated as YAML (gate matches `adw:ship`, `ship_only` output computed,
  `--ship-only` forwarded).
- **Dry-run smoke (to run once secrets are set):** on an issue with an open ADW
  PR, `uv run adws/adw_ship_zte.py <issue> --dry-run` should resolve the branch +
  adw_id, materialize `agents/<adw_id>/adw_state.json`, and stop before merge.

## 5. Known Limitations / Follow-ups

- **Cron re-trigger de-dup:** re-applying `adw:ship` without a new comment won't
  re-fire via the cron poller (latest-comment-id de-dup). The Actions `labeled`
  event re-fires each time the label is applied, so the Actions path is the way
  to re-ship.
- **No open PR / multiple PRs:** the bootstrap aborts to a human (the cron guard
  already prevents launching with no PR); ambiguous multi-PR matches are not
  auto-resolved by design.
- Local ship-only pays the `/install_worktree` cost up front even when no
  auto-fix ends up being needed; a lazy install is a possible future refinement.
