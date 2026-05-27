# Spec 0008 — ZTE: Zero-Touch Engineering Agentic Layer

- **Status:** Implemented (2026-05-26)
- **Branch:** `worktree-zte-agentic-layer`
- **Location:** `adws/**` (new), `.claude/commands/**` (new), `.claude/hooks/**` (new),
  `.github/workflows/adw-zte.yml` (new), `specs/adw/` (new dir), `playwright.config.ts`
  (env-aware ports), `.gitignore`, `CLAUDE.md`
- **Related docs:** `README.md`, `adws/README.md` (operator-facing map of this
  layer), `specs/0006-ci-cd-pipeline.md`, `specs/0007-r2-usage-monitor.md`

## 1. Problem / Objective

We want GitHub issues for this repo to become reviewed, tested, merged code with no
human keystrokes — "Zero-Touch Engineering" (ZTE). This adds an **agentic coding layer**
that drives the `claude` CLI through the full SDLC (plan → build → test → review →
document → ship) for an issue, in isolation, and merges autonomously once the repo's
required checks pass and GitHub Copilot has no high-importance feedback left.

It is implemented as an **AI Developer Workflow (ADW)** system tailored to this repo's
Node/TypeScript stack, CI, branch protection, and Copilot setup. The product's own Claude
integration (`server/src/services/claudeProvider.ts`, for questionnaire analysis) is
unrelated and untouched; the two only share the `ANTHROPIC_*` env-var namespace.

## 2. Approach & Changes

The layer is **markdown command templates** (`.claude/commands/`) that define each agent
step, driven by **Python orchestration** (`adws/`, run with `uv`). Per-run state lives in
`agents/<adw_id>/adw_state.json`; work happens in an isolated git worktree under
`trees/<adw_id>/` (or in place on a branch when running inside CI).

**Python core (`adws/adw_modules/`)** — product-agnostic orchestration modules:
`agent.py` (claude CLI runner; `--output-format stream-json`, retry, model map),
`state.py`, `data_types.py`, `utils.py`, `git_ops.py`, `github.py`, `workflow_ops.py`,
`worktree_ops.py`. New helpers: `phase.py` (worktree-vs-CI context + resilient issue
comments), `orchestrate.py` (pipeline runner), `test_ops.py` (test+resolution loops),
`ship_ops.py` (required-check polling), `copilot_ops.py` (Copilot feedback classify +
resolve).

**Phase scripts (`adws/adw_*.py`)** — `adw_plan` (entry: classify → branch →
worktree → plan-spec → PR), `adw_build`, `adw_test`, `adw_review`,
`adw_document`, `adw_patch`, `adw_ship` (the ZTE shipper), orchestrators
`adw_plan_build`, `adw_plan_build_test`, `adw_plan_build_test_review`,
`adw_sdlc`, and `adw_sdlc_zte` (the full pipeline + ship).

**Commands (`.claude/commands/`)** — 18 templates retargeted to this repo:
`test.md` runs `npm run check → typecheck → test → build` (returning a `TestResult`
JSON array); `test_e2e.md` sources `.ports.env` then `npm run test:e2e`; planning
commands write to `specs/adw/issue-<n>-adw-<id>-<slug>-plan.md`; plus the new
`resolve_copilot_feedback.md`.

**Triggers (3 ways):**
- Local CLI: `uv run adws/adw_sdlc_zte.py <issue> [adw-id] [--dry-run] [--skip-e2e] [--admin] [--max-ship-iters N]`.
- Cron: `adws/adw_triggers/trigger_cron.py` polls issues (label `adw:zte`/`adw:ship`, or a
  comment starting with `adw`), de-dupes via `.cron_state.json` + an open-PR check, and
  launches `run_zte.py`.
- GitHub Actions: `.github/workflows/adw-zte.yml` reacts to `issues`/`issue_comment`/
  `workflow_dispatch`/`repository_dispatch` and runs the pipeline in CI (the
  network-friendly substitute for an inbound webhook).

**The ZTE ship loop (`adw_ship.py`)** is a PR-based, Copilot-iterating, auto-merge loop:
open/find PR → wait for the 4 required checks green on
the head SHA (auto-fixing quality/e2e failures) → fetch Copilot review → classify
high-importance (keyword pre-filter ∪ LLM via `/resolve_copilot_feedback`) → patch, push,
re-request review → loop until green + no high-importance feedback → `gh pr merge --squash
--delete-branch`. Bounded by `--max-ship-iters` (5) and `--checks-timeout` (45m); aborts to
a human (`adw:needs-human` label) on exhaustion, conflicts, or unresolvable feedback.

**Hooks & safety** — `.claude/hooks/{pre_tool_use,post_tool_use,stop}.py`, registered in
`adws/adw_settings.json` and applied via `claude --settings` so they scope to ADW sessions
only. `pre_tool_use` blocks dangerous `rm`, force-push to protected branches, and `.env`
secret access (the real net, since the agent runs with `--dangerously-skip-permissions`,
which bypasses settings allow/deny but not hooks).

## 3. Key Decisions & Rationale

- **Worktrees under `trees/`, not `.claude/worktrees/`.** The harness owns
  `.claude/worktrees/`; keeping autonomous, frequently-destroyed ADW worktrees separate
  prevents the harness and ADW from fighting over the same tree.
- **ADW plan-specs under `specs/adw/`**, disjoint from the curated `specs/NNNN-*.md`
  namespace — no counter race across concurrent runs, no collision. `CLAUDE.md` updated to
  recognize this as a valid spec type.
- **Subscription auth, no API key.** The `claude` CLI uses the user's Pro/Max subscription
  (interactive login locally; `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` in CI).
  `check_env_vars` warns (never blocks) when no credential env var is set.
- **`ADW_GH_TOKEN` (PAT/App), not the default `GITHUB_TOKEN`,** in the Action — otherwise
  bot pushes/PRs would not trigger `ci.yml`/`codeql.yml` and the ship loop would hang.
- **Public-repo trigger guard.** Because this is a public repo, `issues`/`issue_comment`
  events from arbitrary users must not launch a secret-bearing run; the Action's `if:`
  requires the author to be `OWNER`/`MEMBER`/`COLLABORATOR`, and the workflow never
  triggers on `pull_request` (so fork PRs never receive secrets).
- **`ADW_IN_CI=true` runs in place** on a branch (no worktree/ports) — the ephemeral
  runner is already isolated.
- **Mode A merge.** `main` protection requires only the 4 status checks (verified:
  `required_pull_request_reviews: null`, `enforce_admins: false`, `strict: true`), so the
  bot merges once checks are green — no admin bypass needed. `--admin`/`ADW_MERGE_ADMIN`
  remains available (Mode B) if an approval rule is later added. Strict mode is handled by
  `gh pr update-branch` before merge.
- **Four-band port allocation** (`base36(adw_id[:8]) % 15`): dev backend 4110–4124,
  dev frontend 5180–5194, e2e backend 4130–4144, e2e frontend 5200–5214 — above the repo
  defaults (4100/5173 dev, 4101/5174 e2e), enabling 15 concurrent ADWs.
- **One product-code change:** `playwright.config.ts` reads `E2E_SERVER_PORT` /
  `E2E_CLIENT_PORT` / `VRP_DB_PATH` from env with the **same defaults**, so concurrent ADW
  E2E runs get isolated ports while normal local/CI E2E is byte-for-byte unchanged.

## 4. Verification

Verified locally (Python layer — `uv` provides Python 3.12 independent of Node):
- `uv run adws/adw_tests/test_model_selection.py` → model-map coverage, port bands, state
  round-trip all pass.
- Byte-compiled all `adws/**` + `.claude/hooks/**`; imported all 13 `adw_modules`.
- Ship logic unit-checked: `evaluate_checks` returns green/failing/pending correctly
  (incl. CANCELLED→pending for `cancel-in-progress`); Copilot `keyword_severity`
  classifies bug→high, nit→low, ambiguous→None (defer to LLM).
- Hook self-tests: `rm -rf /` and `git push --force origin main` blocked (exit 2),
  `npm run check` allowed (exit 0).
- `adw-zte.yml` and `ci.yml` validated as YAML; `adw_settings.json` validated as JSON.

Delegated to CI (this session's Node is v26, not the pinned 22.18.0, and the worktree has
no `node_modules`): `npm run check / typecheck / build / test:e2e` run under Node 22.18.0
in `ci.yml`. The `playwright.config.ts` change is additive with unchanged defaults, so
existing E2E behavior is preserved.

End-to-end smoke (run once secrets are set — see §5): create a throwaway issue, label it
`adw:zte`, and run `uv run adws/adw_sdlc_zte.py <issue> --dry-run`; confirm a worktree
under `trees/`, a plan-spec under `specs/adw/`, a pushed branch + open PR, the checks
observed green, the Copilot loop running, and that it **stops before merge** (dry run).

## 5. Known Limitations / Follow-ups

- **Operational setup (not code):** add repo secrets `CLAUDE_CODE_OAUTH_TOKEN`
  (`claude setup-token`) and `ADW_GH_TOKEN`; the OAuth token is long-lived but may need
  periodic rotation. Subscription rate limits are shared with interactive Claude Code use.
- No real-time observability dashboard in v1 — hooks log to `agents/<adw_id>/` only; a
  seam is left to add it.
- Copilot severity is heuristic + LLM-judged (the API exposes no severity); the keyword
  guard can only *raise* importance for security/bug language, never downgrade it.
- CI-failure auto-fix covers `quality`/`e2e`; `docker`/CodeQL failures abort to a human.
- Big single PR (per request); the layer is self-contained under `adws/` + `.claude/` and
  invisible to the existing CI gate (Biome excludes `adws/` and Markdown).
- Discoverability follow-up: `adws/README.md` was added as an in-directory operator
  map (phase scripts, ship loop, triggers, layout, kill-switches) so contributors
  landing in `adws/` are pointed here without having to find this spec first.
