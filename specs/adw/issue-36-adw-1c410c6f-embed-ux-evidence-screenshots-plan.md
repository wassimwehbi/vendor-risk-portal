# Spec — Embed UX-validation evidence screenshots inline in the PR verdict comment

- **Status:** Draft
- **Branch:** feat-issue-36-adw-1c410c6f-embed-ux-evidence-screenshots
- **Location:** `adws/adw_modules/github.py`, `adws/adw_modules/ux_ops.py`, `adws/adw_ux_validation.py`, `adws/tests/test_ux_validation.py`
- **Related docs:** `specs/0012-ux-tasks-harness.md`, `adws/adw_modules/data_types.py`

## Problem / Objective

**User Story:** As a PR reviewer, I want to see the actual before/after screenshots from the ADW UX-validation phase rendered inline in the PR verdict comment, so that I can visually confirm the change looks correct without accessing the CI runner's filesystem.

**Problem Statement:** The UX-validation phase (spec 0012, Part B) captures before/after PNG screenshots and posts a SHA-bound verdict comment, but only references the evidence by count and a local path: `_5 evidence artifact(s) captured under agents/<adw_id>/ux_validator/_.` Those paths are on the CI runner or local worktree filesystem — completely inaccessible to any GitHub reviewer. The visual proof the agent worked hard to capture is effectively invisible at review time.

## Approach & Changes

Upload each captured PNG to a **per-PR GitHub release** (`ux-evidence-pr-<pr_number>`) using `gh release create/upload`, then embed the returned `browser_download_url` values as inline `![label](url)` markdown in a collapsible `<details>` block appended to the verdict comment.

**Why GitHub release assets:**
- URLs are publicly renderable in GitHub markdown (unlike Actions artifacts).
- No branch bloat — releases are detached from the tree.
- `gh` CLI already available in CI and local ADW runs.
- `--clobber` on re-upload is idempotent; re-runs replace rather than pile up.
- Tag keyed by `ux-evidence-pr-<pr_number>` (not SHA) keeps one release per PR; the inner asset filenames include the SHA for content-addressability.

**Relevant files:**

- `adws/adw_modules/github.py` — add `upload_ux_evidence(pr_number, sha, evidence_paths) -> list[tuple[str, str]]` helper that creates/ensures the release and uploads each PNG, returning `(label, browser_download_url)` pairs.
- `adws/adw_modules/ux_ops.py` — extend `format_ux_validation_comment(result, evidence_urls=None)` to render an `Evidence` collapsible section with before/after image pairs when URLs are provided; fall back to the existing path-count text when `evidence_urls` is `None` or empty.
- `adws/adw_ux_validation.py` — after `run_ux_validate()` returns, call `upload_ux_evidence()` and pass the resulting URL list into `format_ux_validation_comment`. Wrap the upload in try/except so a failure falls back to the existing text.
- `adws/tests/test_ux_validation.py` — add unit tests for the new `format_ux_validation_comment` behavior when `evidence_urls` is provided, and for before/after pairing logic.

### New Files

None — all changes are to existing files.

### Implementation Plan

**Phase 1 — Foundation:** Add `upload_ux_evidence()` to `github.py`. Keep it a pure function: takes `pr_number`, `sha`, `evidence_paths`; returns `list[tuple[str, str]]` of `(filename_label, url)`. Uses `subprocess.run` with `gh release create --notes ""` (idempotent; `|| true` equivalent via `check=False`) then `gh release upload --clobber` per file. Asset names are `<sha[:8]>_<basename>` to avoid collisions across re-runs.

**Phase 2 — Core Implementation:** Extend `format_ux_validation_comment` in `ux_ops.py` to accept an optional `evidence_urls: list[tuple[str, str]] | None` parameter. When URLs are present, append a `<details><summary>📸 Evidence (N screenshots)</summary>` block. Pair filenames by detecting the `01_before_` / `02_after_` numbering convention: group by the suffix after the ordinal prefix, then render `before` / `after` side-by-side on one line; any file that doesn't match the pattern falls back to a standalone line. Preserve the existing path-count fallback text when `evidence_urls` is `None` or empty.

**Phase 3 — Integration:** In `adw_ux_validation.py`, after `run_ux_validate()` returns a `UxValidationResult`, attempt to upload evidence and capture the URL list. Pass URLs to `format_ux_validation_comment`. All upload work is inside a `try/except Exception` so any failure degrades gracefully. Log the error and fall back to the original behavior.

### Step by Step Tasks

#### Task 1 — Add `upload_ux_evidence` helper to `github.py`

- Read `adws/adw_modules/github.py` to understand existing patterns (subprocess calls, logging, `get_pr_number`, `upsert_pr_comment`).
- Add the function below the existing comment helpers:

```python
def upload_ux_evidence(
    pr_number: str,
    sha: str,
    evidence_paths: list[str],
    repo: str | None = None,
) -> list[tuple[str, str]]:
    """Upload PNG evidence to a per-PR GitHub release and return (label, url) pairs.

    Tag: ux-evidence-pr-<pr_number>
    Asset names: <sha8>_<basename> (idempotent with --clobber).
    Returns [] on any failure — caller must degrade gracefully.
    """
```

- Implementation steps inside the function:
  1. Build `tag = f"ux-evidence-pr-{pr_number}"`.
  2. Build optional `--repo` flag from `repo` param (same pattern as rest of `github.py`).
  3. Create release (idempotent): `gh release create <tag> --title "UX Evidence PR #<pr_number>" --notes "" --prerelease` — use `check=False` and ignore non-zero exit (release already exists is OK).
  4. For each path in `evidence_paths`: construct asset name `f"{sha[:8]}_{os.path.basename(path)}"`, run `gh release upload <tag> <path> --clobber`, log warning on failure, skip that file.
  5. After all uploads: fetch release JSON via `gh release view <tag> --json assets` and parse `assets[].name` + `assets[].browser_download_url` to collect URLs for files we just uploaded (filter by our `sha[:8]_` prefix).
  6. Return list of `(os.path.basename(path), url)` for matched assets.
- Add `import os` if not present (check first).
- Keep a module-level logger call consistent with existing `logging.getLogger(__name__)` pattern.

#### Task 2 — Extend `format_ux_validation_comment` in `ux_ops.py`

- Read `adws/adw_modules/ux_ops.py` in full.
- Update the signature:
  ```python
  def format_ux_validation_comment(
      result: UxValidationResult,
      evidence_urls: list[tuple[str, str]] | None = None,
  ) -> str:
  ```
- Replace the existing `evidence_paths` fallback block (the `_N evidence artifact(s)…_` line) with:
  - If `evidence_urls` is truthy: build and append the collapsible `<details>` Evidence section (see below).
  - Else if `result.evidence_paths`: keep existing fallback text unchanged.
  - Else: append nothing.
- **Before/after pairing logic:**
  ```python
  def _pair_evidence(urls: list[tuple[str, str]]) -> list[str]:
      """Return markdown lines pairing before/after by shared suffix."""
      import re
      pattern = re.compile(r"^(\d+)_(before|after)_(.+)$", re.IGNORECASE)
      groups: dict[str, dict[str, tuple[str, str]]] = {}
      singles: list[tuple[str, str]] = []
      for label, url in urls:
          m = pattern.match(label)
          if m:
              key = m.group(3)  # shared suffix e.g. "new-assessment_mobile.png"
              groups.setdefault(key, {})[m.group(2).lower()] = (label, url)
          else:
              singles.append((label, url))
      lines = []
      for key, sides in groups.items():
          name = key.replace("_", " ").replace(".png", "")
          parts = []
          if "before" in sides:
              parts.append(f"![before]({sides['before'][1]})")
          if "after" in sides:
              parts.append(f"![after]({sides['after'][1]})")
          lines.append(f"**{name}** — " + " ".join(parts))
      for label, url in singles:
          lines.append(f"![{label}]({url})")
      return lines
  ```
- Build the `<details>` block:
  ```python
  n = len(evidence_urls)
  detail_lines = _pair_evidence(evidence_urls)
  block = [
      f"<details><summary>📸 Evidence ({n} screenshot{'s' if n != 1 else ''})</summary>",
      "",
      *detail_lines,
      "",
      "</details>",
  ]
  lines.append("\n" + "\n".join(block))
  ```
- `_pair_evidence` should be a module-private helper (no public export).

#### Task 3 — Wire upload into `adw_ux_validation.py`

- Read `adws/adw_ux_validation.py` in full.
- Locate the call site where `format_ux_validation_comment(ux_result)` is invoked (in the section that builds `body_md` before `upsert_pr_comment`).
- Import `upload_ux_evidence` from `adws.adw_modules.github` (check current import block pattern).
- Wrap the upload attempt:
  ```python
  evidence_urls: list[tuple[str, str]] | None = None
  if ux_result.evidence_paths and pr_number:
      try:
          evidence_urls = upload_ux_evidence(
              pr_number=pr_number,
              sha=head_sha,
              evidence_paths=ux_result.evidence_paths,
              repo=repo,
          )
      except Exception as exc:
          log.warning("UX evidence upload failed — falling back to path reference: %s", exc)
  body_md = format_ux_validation_comment(ux_result, evidence_urls=evidence_urls)
  ```
- Confirm `head_sha` and `pr_number` are already available at that call site (they are — used in `ux_marker_body`). If `pr_number` is not a `str` at that point, convert with `str(pr_number)`.
- Do NOT change the issue-comment fallback path (no PR case) — it already uses `format_ux_validation_comment` and will implicitly benefit.

#### Task 4 — Update unit tests in `test_ux_validation.py`

- Read `adws/tests/test_ux_validation.py` in full.
- Add a new test class or test functions for the extended `format_ux_validation_comment`:
  - `test_format_comment_with_evidence_urls_before_after_pair` — given a `UxValidationResult` with `evidence_paths` and a matching `evidence_urls` list containing `01_before_foo.png` / `02_after_foo.png` pairs, assert the output contains `<details>`, `📸 Evidence`, `![before]`, `![after]`, and the shared key name.
  - `test_format_comment_with_evidence_urls_singles` — filenames that don't match the ordinal pattern render as standalone `![label](url)` lines.
  - `test_format_comment_no_urls_fallback` — when `evidence_urls=None` and `result.evidence_paths` is non-empty, output still contains the existing `_N evidence artifact(s)_` text.
  - `test_format_comment_empty_urls_fallback` — when `evidence_urls=[]` (upload returned nothing), same fallback.
  - `test_format_comment_singular_plural` — 1 screenshot → "1 screenshot", 3 → "3 screenshots".
- Extend the existing `test_format_ux_validation_comment` test to ensure it still passes (no regression).

#### Task 5 — Run validation commands

- Run all validation commands listed in the Validation Commands section.
- Fix any type errors, test failures, or lint issues.
- Confirm no regressions.

## Key Decisions & Rationale

**GitHub release assets vs. alternatives:**
- *Actions artifacts*: No embeddable URL — rejected.
- *Committing PNGs to branch*: Branch bloat, complicates history — rejected.
- *External image hosting*: Introduces external dependency, privacy concerns — rejected.
- *GitHub release assets*: Durable URLs (`browser_download_url`) render as `<img>` in GitHub markdown, use the existing `gh` CLI already present in all run environments, no new dependencies — chosen.

**Per-PR tag (`ux-evidence-pr-<pr_number>`) not per-SHA:**
- One release per PR keeps releases tidy; SHA is encoded in the asset *name* (`<sha8>_<basename>`).
- `--clobber` on re-upload replaces the old asset in the same release — no accumulation per re-run.
- Deleting the release on PR merge is a clean follow-up (noted as optional in the issue).

**`--prerelease` flag on release:**
- Keeps UX evidence releases out of the "latest" slot and clearly marked as automation artifacts.

**Fail-safe / graceful degradation:**
- The upload and URL fetch are wrapped in `try/except`. Any failure (network, permissions, `gh` not installed) falls back to the existing `_N evidence artifact(s)_` text — the verdict comment is never lost.
- `upload_ux_evidence` returns `[]` on per-file upload failure (logs a warning) rather than raising, so partial uploads still produce partial inline images.

**Signature extension is backward-compatible:**
- `evidence_urls` is optional with default `None`. Existing callers of `format_ux_validation_comment` need no changes.

**No new external Python dependencies:**
- All implementation uses stdlib (`subprocess`, `os`, `re`, `json`) plus the already-present `gh` CLI.

## Verification

### Unit Tests & Edge Cases

**Edge cases that must be covered:**
- `evidence_urls=None` → existing path-count text (fallback).
- `evidence_urls=[]` → same fallback (upload returned nothing).
- Perfect before/after pair → single paired line with `![before]` + `![after]`.
- Orphaned before (no matching after) → still renders, just `![before]`.
- Files not matching ordinal pattern → standalone `![label](url)` lines.
- Mixed paired + single files in same result.
- 1 screenshot → singular "1 screenshot" (not "1 screenshots").
- N > 1 screenshots → plural.
- `evidence_paths` empty but `evidence_urls` provided (shouldn't happen but shouldn't crash).

### Acceptance Criteria

1. The UX-validation PR verdict comment embeds before/after screenshots **rendered inline** (not just a count/path) for every verdict (PASS, NEEDS_FIXES, NOT_APPLICABLE).
2. Images render for any GitHub reviewer via durable `browser_download_url` values.
3. The evidence section is wrapped in a `<details>` collapsible block to keep the comment scannable.
4. Before/after pairs are grouped on a single line when the ordinal filename convention is followed.
5. Re-runs on a new head SHA upload assets with `--clobber` to the same per-PR release tag — no duplicate releases, no unbounded asset growth per re-run.
6. Upload failure degrades to the existing `_N evidence artifact(s) captured under …_` text; the verdict comment is never dropped or broken.
7. `format_ux_validation_comment` is backward-compatible — existing callers with no `evidence_urls` argument continue to work.
8. All existing unit tests pass without modification.
9. New unit tests cover: before/after pairing, singles, fallback (None), fallback (empty list), singular/plural.

### Validation Commands

```bash
# From repo root:

# Run server unit tests (includes test_ux_validation.py)
npm --prefix server run test
# Or directly via uv if the test runner is Python:
cd adws && uv run pytest tests/test_ux_validation.py -v

# Type-check (Python type checking via mypy or pyright if configured)
# Check if mypy is configured:
cd adws && uv run mypy adw_modules/github.py adw_modules/ux_ops.py adw_ux_validation.py --ignore-missing-imports || true

# Biome lint + format (JS/TS only — Python not covered)
npm run check

# TypeScript type checks
npm run typecheck

# Full test suite
npm run test

# Client production build
npm run build
```

## Known Limitations / Follow-ups

- **Optional follow-up (noted in issue):** Delete the `ux-evidence-pr-<n>` GitHub release on PR merge to keep releases tidy. This would require a hook in `adw_ship.py` or a separate GitHub Actions workflow step.
- **Private repos:** `browser_download_url` for release assets on private repos may require authentication. If the repo is private, reviewers authenticated with GitHub will see the images normally in the PR interface (GitHub renders them authenticated). This is consistent behavior.
- **Asset URL parsing:** The implementation fetches the release JSON after uploading to get canonical URLs. An alternative is to construct the URL from the known pattern, but parsing from the API is more robust against GitHub URL format changes.
- **`gh` CLI version:** The implementation relies on `gh release create` and `gh release upload --clobber`. These flags have been stable since `gh` 2.x. No version pinning needed.
- **Evidence filenames:** The before/after pairing relies on the `NN_before_` / `NN_after_` naming convention established in `ux_validate.md`. If the convention changes, pairing degrades gracefully to standalone lines (no crash).
