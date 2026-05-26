# Spec 0010 — Deactivate Dependabot version updates

- **Status:** Implemented (2026-05-26)
- **Branch:** `chore/0010-disable-dependabot`
- **Location:** `vendor-risk-portal/` — removes `.github/dependabot.yml`.
- **Related docs:** `specs/0006-ci-cd-pipeline.md` (the CI/CD buildout that introduced the Dependabot config alongside the GitHub Actions workflows).
- **Builds on:** Spec 0006 added `.github/dependabot.yml` configuring weekly grouped npm + github-actions version updates across `/`, `/server`, and `/client`. This spec turns that off.

## 1. Problem Statement & Objective

The weekly Dependabot version-update schedule produced a high volume of PRs that each
require manual review and validation — notably **major-version bumps, which the config does
not group**, so every standalone PR is a breaking-candidate upgrade (Tailwind 3→4, Vite
5→8, React 19, etc.). The maintenance cadence this implies is more than the project is
ready to absorb right now.

Objective: stop Dependabot from opening any further PRs, with no other behavioral change to
CI/CD or security posture, and in a way that is trivial to reverse later.

## 2. Approach & Changes

- **Remove `.github/dependabot.yml`.** Dependabot **version updates** are enabled solely by
  the presence of this file; deleting it stops all scheduled version-update PRs for every
  configured ecosystem. No GitHub repo-settings change is required.
- **Close the outstanding queue.** The 11 open Dependabot PRs at the time of this change
  (#4, #5, #6, #7, #9, #10, #11, #12, #13, #14, #15) were closed with an explanatory
  comment. The one minor/patch group PR (#19) was reviewed and merged before deactivation;
  see its discussion for the `@anthropic-ai/sdk` 0.32→0.98 note.
- **No change to Dependabot security updates / alerts.** These were already disabled on the
  repository (the `GET /repos/{owner}/{repo}/vulnerability-alerts` endpoint returned `404`),
  so removing the version-update config fully deactivates Dependabot's PR-generating
  behavior. There is nothing further to switch off.

## 3. Key Decisions & Rationale

- **Delete the file rather than neuter it.** Removing the file is the unambiguous,
  fully-effective deactivation. The carefully tuned grouping config is preserved in git
  history (it was added in the Spec 0006 CI/CD work), so re-enabling is a single revert
  rather than a rewrite — see §5.
- **Leave security alerts as-is.** They are already off and, when on, are high-signal and
  fire only on real advisories. This change is deliberately scoped to the *version-update*
  noise that motivated it; it does not weaken (or alter) the security posture.
- **Spec-only + config change still goes through a PR.** `main` is protected; per repo
  convention every change ships as a PR with a spec, even a deactivation chore.

## 4. Verification

- `.github/dependabot.yml` no longer exists on the branch; `.github/` retains only
  `workflows/`.
- `gh pr list --author app/dependabot --state open` returns empty after the close pass.
- No remaining open PRs other than the unrelated human PR #21.
- The required status checks (`quality`, `e2e`, `docker`, `Analyze`) are unaffected — this
  change touches no application code or workflow.

## 5. Known Limitations / Follow-ups

- **Manual dependency hygiene now.** With Dependabot off, dependency and (if later enabled)
  security updates must be tracked manually. Revisit when there is appetite for the review
  cadence.
- **How to re-enable.** Revert this PR (restores `.github/dependabot.yml` verbatim), or
  re-author the config. Consider, at that time, splitting **major** updates into their own
  schedule/limits — or pinning `versioning-strategy`/`ignore` rules for majors — so the
  queue is dominated by low-risk minor/patch groups rather than breaking-candidate bumps.
