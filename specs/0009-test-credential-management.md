# Spec 0009 — Test credential management (R2 live test, local + CI)

- **Status:** Implemented (2026-05-26)
- **Branch:** `claude/r2-usage-monitor-patch-XyOnA`
- **Location:** `vendor-risk-portal/` — `server/test/r2-monitor.live.ts` (load project-root `.env`), `.github/workflows/r2-live.yml` (new opt-in CI workflow), `.env.example` (note the live-test use), `README.md` (live test + CI/CD notes), `.gitignore` (ignore Claude Code worktrees).
- **Related docs:** `specs/0007-r2-usage-monitor.md` (the monitor + the live test/CLI being credentialed), `specs/0006-ci-cd-pipeline.md` (the existing GitHub Actions setup), `specs/0004-free-demo-deployment.md` (where the R2 credentials originate).
- **Builds on:** Spec 0007 added the opt-in live integration test (`test/r2-monitor.live.ts`) and the `r2:check` CLI. Both need real Cloudflare credentials; this spec defines how those credentials are supplied — locally and in CI — without ever committing them.

## 1. Problem Statement & Objective

The R2 usage-monitor live test hits the real Cloudflare R2 Analytics API and needs two
values: `CLOUDFLARE_API_TOKEN` (scope: **Account Analytics: Read** — read-only) and
`R2_ACCOUNT_ID`. We want to run it **locally and in CI without putting either value into
any committed config**, using a **free** mechanism that scales to more credentialed tests
later. Two constraints shaped the design:

- The repo is **public**, so any secret used by CI must be unreachable from pull requests
  (a fork PR must never be able to exfiltrate the token).
- GitHub Actions secrets are **write-only** — they can't be read back via the API or `gh`
  CLI — so they can't double as a vault you pull from to run the test on a laptop.

Objective: keep everything on infrastructure already in use (local `.env` + GitHub
Actions), add no paid service, and make the live test a clean no-op when unconfigured.

## 2. Approach & Changes

- **Local — git-ignored `.env`.** The live test now loads the project-root `.env` before
  its skip check by importing the existing dotenv loader (`import '../src/env';` as the
  first line of `server/test/r2-monitor.live.ts`), exactly as the sibling CLI
  `server/scripts/r2-usage-report.ts` already does. Developers set the two values once in
  `.env` (already git-ignored; the vars are documented in `.env.example`) and run
  `npm --prefix server run test:live`. `dotenv.config` no-ops when `.env` is absent and
  never overrides already-set vars, so the test still self-skips with no creds and CI's
  injected env still wins (see below). The test's explicit `VRP_DB_PATH` override, set
  after the import, still points SQLite at a throwaway DB.
- **CI — GitHub Environment secrets, no PR trigger.** A new `.github/workflows/r2-live.yml`
  runs the live test on a nightly `schedule` (`37 4 * * *`, UTC) and on `workflow_dispatch`.
  It has **no `push`/`pull_request` trigger**. The two credentials are stored as secrets on
  a GitHub **Environment** named `r2-live` and injected as job-level `env:` from
  `secrets.*`. The job installs server deps (`npm --prefix server ci`) and runs
  `npm --prefix server run test:live` on a GitHub-hosted `ubuntu-latest` runner.
- **One-time setup (out of band — not committed):**
  ```bash
  gh api -X PUT repos/wassimwehbi/vendor-risk-portal/environments/r2-live   # create environment
  gh secret set CLOUDFLARE_API_TOKEN --env r2-live                          # prompts for value
  gh secret set R2_ACCOUNT_ID        --env r2-live
  ```
  Optionally restrict the `r2-live` environment's deployment branch policy to `main`.
- **Docs:** `.env.example` notes that the two R2 vars also enable `test:live`; `README.md`
  documents the local flow (already present) and the new CI workflow.
- **Local test execution requires the pinned Node.** The suite uses native `better-sqlite3`,
  whose binary is ABI-specific, so a newer Node (e.g. 26) fails to load it (`ERR_DLOPEN_FAILED`)
  and rebuilding needs a C toolchain. Select the `.nvmrc` version first — `fnm use` (or `nvm use`)
  → 22.18.0 — then `npm --prefix server ci && npm --prefix server test`. This matches the Node CI
  runs, and `fnm`'s `--use-on-cd` hook makes the switch automatic on `cd`.
- **Repo hygiene — ignore Claude Code worktrees.** `.gitignore` now excludes
  `.claude/worktrees/`. Those machine-local scratch checkouts each carry their own
  `biome.json` (a nested root config) which otherwise made `biome ci .` fail and cluttered
  `git status`; Biome skips them because it honors `.gitignore` via `vcs.useIgnoreFile`.

## 3. Key Decisions & Rationale

- **Schedule + manual only, never on PRs.** On a public repo, exposing a secret to
  `pull_request` runs would let a fork PR read it. `schedule` and `workflow_dispatch` both
  execute in the trusted context on the default branch, so the token stays unreachable by
  outside contributors. The live test is also non-deterministic (depends on real account
  usage), which is a poor fit for a per-PR merge gate.
- **GitHub Environment secrets, not repo secrets.** Scoping the credentials to an
  environment lets us attach protection rules / a branch policy and keeps them grouped with
  this single workflow, rather than widening the blast radius to every workflow.
- **Local uses `.env`, not GitHub.** GitHub Actions secrets are write-only, so there is no
  GitHub-native way to pull the token down to a laptop; a git-ignored `.env` is the simplest
  free local store and matches how the rest of the app already reads configuration.
- **Reuse the existing dotenv loader.** Importing `src/env.ts` (rather than adding
  `--env-file` to the npm script) keeps `.env` resolution identical to the server and the
  `r2:check` CLI, and stays robust regardless of the process CWD.
- **No new infrastructure / $0.** Everything runs on GitHub-hosted runners (free for public
  repos) and a local file — consistent with the free-tier promise of Specs 0004 and 0007.

## 4. Verification

- `npm --prefix server run typecheck` — passes.
- `npm --prefix server test` — unchanged; the default `test/*.test.ts` glob excludes
  `*.live.ts`, so the suite stays offline and green.
- `npm --prefix server run test:live` **without** credentials — both cases **skip** with the
  documented reason and the command exits 0 (unchanged behavior).
- `npm --prefix server run test:live` **with** `.env` populated — both cases run (not
  skipped) and print the live month-to-date usage summary.
- `npm run check` (Biome) — exits 0 (the `.claude/worktrees/` ignore removes the nested-config
  error; remaining diagnostics are pre-existing warnings/infos, none from the touched files).
- Local toolchain (Node 22.18.0 via `fnm use`): `npm --prefix server ci` then
  `npm --prefix server test` → 69/69 pass; `npm --prefix server run test:live` with no creds →
  2 skipped, 0 failed.
- **Live run, real credentials (2026-05-26):** with a valid Account-Analytics:Read token in
  `.env`, `test:live` → 2/2 pass and printed an `OK` usage report. The run also surfaced a real
  GraphQL bug in the monitor (fixed — see `specs/0007-r2-usage-monitor.md`), which is the whole
  point of having a live test. The same two values are now stored as `r2-live` GitHub
  Environment secrets, so `r2-live.yml` runs the same check in CI.
- CI: after the one-time setup, `gh workflow run r2-live.yml` dispatches the job, which runs
  the live test from the `r2-live` environment secrets and goes green; the workflow does not
  appear on any PR run.

## 5. Known Limitations / Follow-ups

- **Manual one-time setup (done 2026-05-26).** The `r2-live` environment and its two secrets
  were created via `gh`; this lives outside the repo, so if the repo/secrets are rebuilt they
  must be re-entered (same model as the Render/Cloudflare dashboards today). The token must be
  a **custom "Account Analytics: Read"** API token — *not* an R2 object-storage token, which
  authenticates but lacks analytics access.
- **Scheduled-workflow caveats.** A `schedule` trigger fires only from the default branch
  (so the job is runnable only after this merges to `main`), and GitHub auto-pauses
  scheduled workflows after ~60 days of repo inactivity (one push re-enables them).
- **Doesn't scale to a true CLI-SSO vault.** If many credentialed tests or contributors
  arrive, migrate to a free secret manager with SSO CLI login and keyless CI — e.g.
  Infisical (open-source, self-hostable, GitHub-OIDC) or Doppler — or a Cloudflare
  Access–gated secrets endpoint, replacing the local `.env` step while keeping CI on GitHub.
- **Nightly cost of a live call.** The scheduled run makes one read-only Analytics query per
  night; negligible, but it is a recurring external call rather than fully offline CI.
