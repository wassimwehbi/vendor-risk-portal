# Resolve Merge Conflicts

Resolve the git **merge conflicts** left by merging `origin/main` into the current ADW PR branch, so the branch can be brought up to date and re-enter CI. A merge is already in progress (do NOT start or abort it).

## Variables

adw_id: $1
conflicted_files: $2 — comma-separated list of files with conflict markers

## Instructions

- A `git merge origin/main` is in progress and left conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in the `conflicted_files`. Run `git status` and `git diff --diff-filter=U` to see them.
- For EACH conflicted file, resolve by **understanding both sides and preserving both intents** — this is integrating two independently-correct changes, not choosing a winner:
  - `<<<<<<< HEAD` is **our** change (this PR's feature/fix).
  - `>>>>>>> origin/main` is what landed on `main` since this branch was cut.
  - Combine them so both behaviors are kept. Only drop one side if they are genuinely mutually exclusive, and then keep the one that satisfies BOTH features' requirements.
- Read enough surrounding code (and the PR's plan-spec under `specs/adw/` if present) to resolve correctly — don't just stitch the markers.
- IMPORTANT: This is a vendor-risk app. Never resolve a conflict in a way that weakens the human-in-the-loop approval contract, changes risk-scoring/classification logic incorrectly, or drops a security/validation check. If two sides conflict on such logic and you cannot safely reconcile them, STOP and report failure (do not guess).
- Remove EVERY conflict marker from every file. Respect TypeScript strict mode + Biome formatting and Python typing conventions.
- IMPORTANT: Do NOT run `git add`, `git commit`, `git merge --continue`, or `git merge --abort`. The orchestrator completes (or aborts) the merge after verifying your resolution. Just edit the files to a correct, marker-free state.
- After editing, run `grep -rn '<<<<<<<\|>>>>>>>' <files>` to confirm no markers remain.

## Conflicted Files

$2

## Report

- State, per file, how you reconciled the two sides (1 line each).
- End with `RESOLVED` if every marker is gone and the result is correct, or `UNRESOLVED: <reason>` if you could not safely resolve a conflict.
