# Spec 0012 — UX Tasks Harness for ADW

- **Status:** Part A implemented (2026-05-27); Part B planned (same branch/feature)
- **Branch:** `worktree-feat-adw-ux-tasks-harness`
- **Location:**
  - **Part A (implemented):** `e2e/ux/scenarios.ts`, `e2e/ux/harness.ts`,
    `e2e/ux/ux.spec.ts`, `e2e/ux/auth.ts`, `e2e/ux/auth.setup.ts` (new);
    `playwright.ux.config.ts` (new); `playwright.config.ts`, `package.json`,
    `.gitignore` (modified); `.github/workflows/ux-regression.yml` (new).
  - **Part B (planned):** `adws/adw_modules/ux_detection.py`, `adws/adw_modules/ux_ops.py`,
    `adws/adw_ux_validation.py`, `adws/adw_tests/test_ux_detection.py`,
    `adws/adw_tests/test_ux_validation.py` (new); `.claude/commands/{test_ux,resolve_failed_ux_test,ux_validate}.md`
    (new); `adws/adw_modules/{data_types,state,agent,github,ship_ops,utils}.py`,
    `adws/{adw_plan,adw_ship,adw_sdlc,adw_sdlc_zte,adw_plan_build_test_review}.py`,
    `.claude/commands/{feature,bug,chore,patch,review}.md` (modified).
- **Related docs:** `specs/0005-responsive-mobile-layout.md` (responsive invariants this
  encodes), `specs/0006-ci-cd-pipeline.md` (CI conventions mirrored), `specs/0008-zte-agentic-layer.md`
  (the ADW pipeline Part B extends), `specs/0009-test-credential-management.md`, `README.md`.

## 1. Problem / Objective

ADW had no concept of "UX work". It classified an issue's *type*, ran a flat Playwright
smoke suite, reviewed against the plan-spec, and shipped once `quality`/`e2e`/`docker`/CodeQL
passed. There was **no UX detection, no workflow adaptation for visual changes, no in-ADW
proof a UX change actually rendered, no UX-specific PR gate, and no scenario-driven UX
regression suite.** The date-input mobile-overflow bug that shipped and was fixed twice
(#18/#23) is exactly the class of regression that slipped through.

This adds a **UX tasks harness** in two parts:
- **Part A** — a declarative, scenario-driven UX regression suite over the whole UX surface,
  wired into GitHub Actions as a blocking PR check + a nightly sweep.
- **Part B** — ADW orchestration that detects UX work across *all* work types, adapts the
  pipeline, visually confirms the change in-ADW, posts a PR verdict, and gates ship.

## 2. Approach & Changes

### Part A — scenario-driven UX regression harness (implemented)

- **Declarative manifest** (`e2e/ux/scenarios.ts`): a `UxScenario[]` of ~10 scenarios
  covering all 9 routes. Each scenario lists a role, viewports (mobile 375 / tablet 768 /
  desktop 1280), a small union of `Step`s (reusing the showcase demo-loader + dev sign-in
  proven in `e2e/smoke.spec.ts`), and the `Invariant`s to assert. Extending coverage = adding
  a manifest entry; no new test code.
- **Generic runner + fixture** (`e2e/ux/ux.spec.ts`, `harness.ts`): iterates manifest ×
  viewports and asserts deterministic, cross-platform-stable invariants —
  `noHorizontalOverflow` (page-level `scrollWidth - innerWidth ≤ 1px`, naming offending nodes
  on failure), `axeClean` (`@axe-core/playwright` WCAG2A/AA, no serious/critical), `noConsoleErrors`,
  `focusVisibleRing` (the shared `focus:ring-*` box-shadow), and `printNoToolbar` (`.no-print`
  hidden under print media).
- **Reused-session auth** (`auth.ts`, `auth.setup.ts`): a Playwright `setup` project mints one
  session per role via the dev sign-in and persists `storageState`; specs reuse it. This keeps
  the suite under the server's 20-logins / 15-min rate limit and cuts runtime (~24s for 26 tests).
- **Separate Playwright project** (`playwright.ux.config.ts`): reuses the base offline
  `webServer` verbatim; `playwright.config.ts` gains `testIgnore: ['**/ux/**']` so
  `npm run test:e2e` stays the smoke suite. New scripts: `test:ux`, `test:ux:update`. New
  devDependency: `@axe-core/playwright`.
- **Workflow** (`.github/workflows/ux-regression.yml`): `ux` (blocking PR check), `ux-nightly-issue`
  (self-heal), `ux-visual` (advisory nightly pixels), `update-baselines` (Linux-only dispatch).

### Part B — ADW orchestration integration (planned)

- **`ux_detection.py`** — layered, fail-open detection for *all* work types: authoritative git
  diff over UX paths (`client/src/**`, `index.css`, `tailwind.config.*`) ∨ issue keyword/label/
  screenshot heuristic ∨ plan self-declaration. Result recorded to ADW state.
- **`adw_ux_validation.py`** (new phase, after review / before document, self-skips for non-UX):
  runs the deterministic `npm run test:ux` (with a resolve loop) and a `/ux_validate` agent that
  drives the live app via **chrome-devtools MCP** (fallback Playwright screenshots), captures
  before/after evidence, audits it against the plan's UX acceptance criteria, and posts an
  idempotent, author-owned, SHA-bound verdict comment (agent prints, Python posts).
- **Ship gating** (`ship_ops.py`): the `ux` check is appended to the waited-on required checks
  only when UX work is detected (`ADW_UX_GATE`, default `block`); `ux` is not auto-fixable
  (visual regressions abort to a human). Non-UX runs are byte-for-byte unchanged.
- **Plan/review templates** gain a "UX Scenarios, Acceptance & Evidence Checklist" section when
  UX is detected (the plan→evidence→impl-audit handshake).

## 3. Key Decisions & Rationale

1. **Playwright + chrome-devtools, split by role.** Playwright is the deterministic backbone
   (CI/nightly regression + before/after capture); chrome-devtools MCP is the agent's
   interactive qualitative confirmation. They are complementary, not competing.
2. **Deterministic invariants block; pixels are nightly-advisory.** `toHaveScreenshot` pixel
   baselines are cross-platform-flaky (macOS host font antialiasing ≠ Ubuntu CI), so they run
   **only in the nightly `ux-visual` job** (`continue-on-error`, never on the blocking PR check),
   with baselines generated **only on Linux CI** via the `update-baselines` dispatch. The
   `{-platform}` snapshot token prevents a stray macOS baseline from masquerading as the Linux one.
3. **The `ux` PR check blocks merge.** It is deterministic, so wedge-risk is low, and blocking is
   the point of regression prevention. The agent's qualitative verdict (Part B) stays advisory.
4. **Self-heal, not self-rewriting.** A nightly failure files an `adw:zte`+`ux` issue that the
   existing `adw-zte.yml` picks up to ship a fix. No eval-score / weekly agent-rewrite loop.
5. **Always-run required check (strict-mode safety).** Branch protection is strict, where a
   *skipped* required check deadlocks the PR. The `ux` job therefore always runs to a conclusion;
   an internal `git diff` change-detector does a fast green pass-through for non-UI PRs instead of
   a `paths:`/`if:` skip.
6. **No ignores — fixed the pre-existing debt at the root.** The harness surfaced three real,
   pre-existing problems; rather than baseline them, they were fixed so the gate runs with **every**
   axe rule enabled, no `disableRules`, no console ignore-list, and `noHorizontalOverflow` on every
   surface: (a) **contrast** — muted `text-slate-400` (≈2.45:1) raised to `slate-500`, and chips on
   `bg-slate-100` raised to `slate-700` (≥4.5:1); (b) **scrollable-region-focusable** — the
   two read-only overflow tables (audit, report) with no focusable cells got `tabIndex={0}` (the WAI
   scrollable-region pattern); the other tables already contain focusable controls; (c) **ReviewWorkspace page overflow** — the 8-column analyzed table phantom-scrolled the
   whole page on narrow viewports (Chromium: `<html>` scrolled while `<body>`/`<main>` did not),
   fixed with `contain: paint` on the scroll container so its horizontal scroll stays contained
   (the spec 0005 §6 table still scrolls internally).

## 4. Verification

- **Local:** `npm install` (root, pulls axe) + `npm run install-all` (server/client) →
  `npm run test:ux` boots the offline stack on :4101/:5174 and runs the manifest × viewports;
  26 scenario tests + 2 auth setups pass (~24s). `npm run test:e2e` still runs only the 2 smoke
  tests. `biome ci .` clean. (Local dev uses Node 22.18.0 per `.nvmrc`; `better-sqlite3` ships a
  prebuilt for that ABI.)
- **PR check:** `ux` always runs; UI PRs run the full suite, non-UI PRs pass through green; the
  HTML report uploads as `ux-playwright-report`. The `ux` context satisfies branch protection.
- **Nightly:** the structural safety net files an `adw:zte`+`ux` issue on failure; `ux-visual`
  runs advisory pixel diffs and uploads `ux-visual-report`.
- **Baseline refresh:** `workflow_dispatch` with `update_baselines=true` regenerates and commits
  `e2e/ux/__screenshots__/` on Ubuntu (never from macOS).

## 5. Known Limitations / Follow-ups

- **Branch protection (out of repo):** `ux` must be added to `main`'s required status-check
  contexts via `gh api` (alongside `quality, e2e, docker, Analyze (javascript-typescript)`).
- **`/invite`** is token-dependent offline and is not yet covered (deferred).
- **No suppressions in the harness or app a11y rules.** Axe runs with all WCAG2A/AA rules enabled
  (no `disableRules`), every console error fails the suite (no ignore-list), and
  `noHorizontalOverflow` gates every scenario. The three pre-existing issues above were fixed at
  the source, not baselined. The only lint suppressions are two documented `biome-ignore`s for
  `noNoninteractiveTabindex` on the audit/report scroll regions — Biome's heuristic conflicts with
  the WAI scrollable-region `tabindex=0` pattern, and axe enforces the actual requirement.
- **Pixel diffing** starts nightly-advisory; promote to a blocking signal once the Linux
  baseline-refresh ritual is proven. R2 baseline storage (vs committed PNGs) is a future option.
- **Part B** (the ADW orchestration) lands next; until its `ux` ship-gating is wired, the
  harness is already useful as a standalone CI gate.
- **Mobile is resized, not touch-emulated.** The 375px viewport uses `setViewportSize` on
  the Desktop Chrome project (fine pointer), so `@media (pointer: coarse)` rules (e.g. the
  coarse-pointer half of the #18/#23 date-input fix) are not exercised. Follow-up: add a
  touch-emulated mobile Playwright project (e.g. a Pixel device descriptor) and route the
  `mobile` viewport through it.
