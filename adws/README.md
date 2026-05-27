# ADW — AI Developer Workflow (ZTE agentic layer)

This directory is the **Zero-Touch Engineering (ZTE)** layer: a Python (`uv`)
orchestration system that drives the `claude` CLI through the full SDLC —
**plan → build → test → review → document → ship** — for a GitHub issue, in an
isolated git worktree, and merges autonomously once the repo's required checks
pass and GitHub Copilot has no high-importance feedback left.

> **Read the design spec first:** [`specs/0008-zte-agentic-layer.md`](../specs/0008-zte-agentic-layer.md)
> covers the architecture, key decisions, safety model, and operational setup in
> full. This README is just the map.

The agent steps themselves are markdown command templates in `.claude/commands/`;
the Python here orchestrates them. Per-run state lives in
`agents/<adw_id>/adw_state.json`, work happens in `trees/<adw_id>/` (or in place
on a branch when running inside CI).

## Phase scripts (`adw_*.py`)

Each is runnable on its own (`uv run adws/<script>.py <issue> [adw-id] [flags]`):

| Script | Phase |
| --- | --- |
| `adw_plan.py` | Classify an issue, create branch + worktree, write a plan-spec to `specs/adw/`, open a draft PR. **Entry point** for a feature. |
| `adw_build.py` | Implement the plan in the worktree (requires `adw_plan` to have run). |
| `adw_test.py` | Run check → typecheck → test → build (+ optional E2E) with automatic failure resolution. |
| `adw_review.py` | Review the implementation against the plan-spec, capture screenshots, patch blockers. |
| `adw_document.py` | Generate feature documentation under `app_docs/`. |
| `adw_patch.py` | Fast path: turn an issue directly into a small targeted patch (no full feature plan). |
| `adw_ship.py` | The ZTE shipper — PR-based, Copilot-iterating, auto-merge loop (see below). |

**Orchestrators** chain the phases:

- `adw_plan_build.py` — plan → build
- `adw_plan_build_test.py` — plan → build → test
- `adw_plan_build_test_review.py` — plan → build → test → review
- `adw_sdlc.py` — plan → build → test → review → document (no ship)
- `adw_sdlc_zte.py` — **the full pipeline + ship** (zero-touch)

### The ship loop (`adw_ship.py`)

Open/find PR → wait for the 4 required checks (quality, e2e, docker, CodeQL)
green on the head SHA, auto-fixing quality/e2e failures → fetch Copilot review →
resolve high-importance feedback → loop until green with no high-importance
items → squash-merge and delete the branch. Bounded by `--max-ship-iters` (5)
and `--checks-timeout` (45m); aborts to a human via the `adw:needs-human` label
on exhaustion, conflicts, or unresolvable feedback. `docker`/CodeQL failures are
not auto-fixed — they abort to a human.

## Triggers (3 ways)

1. **Local CLI:**
   `uv run adws/adw_sdlc_zte.py <issue> [adw-id] [--dry-run] [--skip-e2e] [--admin] [--no-copilot] [--max-ship-iters N]`
2. **Cron poller:** `adw_triggers/trigger_cron.py` polls issues (label
   `adw:zte` / `adw:ship`, or a comment starting with `adw`), de-dupes via
   `.cron_state.json` + an open-PR check, and launches `run_zte.py`.
3. **GitHub Actions:** `.github/workflows/adw-zte.yml` reacts to
   `issues` / `issue_comment` / `workflow_dispatch` / `repository_dispatch` and
   runs the pipeline in CI (the network-friendly substitute for an inbound
   webhook). Trigger is gated to repo owners/members/collaborators.

`run_zte.py` is the thin, stable entry point shared by the cron and Actions
triggers.

## Layout

```
adws/
  adw_*.py              phase scripts + orchestrators (above)
  adw_modules/          orchestration core (product-agnostic):
                          agent.py (claude CLI runner), orchestrate.py,
                          phase.py, state.py, data_types.py, utils.py,
                          git_ops.py, github.py, workflow_ops.py,
                          worktree_ops.py, test_ops.py, ship_ops.py,
                          copilot_ops.py
  adw_triggers/         trigger_cron.py (poller), run_zte.py (entry point)
  adw_tests/            unit tests (e.g. test_model_selection.py)
  adw_settings.json     Claude Code hook registry (scopes hooks to ADW sessions)
  pyproject.toml        uv project definition
```

## Safety & kill-switches

- **`.claude/hooks/`** (`pre_tool_use`, `post_tool_use`, `stop`), registered in
  `adw_settings.json` and applied via `claude --settings`. `pre_tool_use` blocks
  dangerous `rm`, force-push to protected branches, and `.env` access — the real
  guard, since the agent runs with `--dangerously-skip-permissions`.
- **Kill-switches:** the `adw:freeze` label and `ADW_DISABLED=true`.
- **`ADW_IN_CI=true`** runs in place on a branch (no worktree/ports).

## Setup & tests

- **Secrets (operational, not code):** repo secrets `CLAUDE_CODE_OAUTH_TOKEN`
  (from `claude setup-token`) and `ADW_GH_TOKEN` (a PAT/App token, *not* the
  default `GITHUB_TOKEN`, so bot pushes still trigger CI). See spec 0008 §5.
- **Run the unit tests:** `uv run adws/adw_tests/test_model_selection.py`.
