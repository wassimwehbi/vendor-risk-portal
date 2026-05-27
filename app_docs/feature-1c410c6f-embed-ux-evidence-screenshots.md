# Embed UX Evidence Screenshots Inline in PR Comment

**ADW ID:** 1c410c6f
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/issue-36-adw-1c410c6f-embed-ux-evidence-screenshots-plan.md

## Overview

The ADW UX-validation phase now uploads before/after PNG screenshots to a per-PR GitHub release and embeds them as inline images in the PR verdict comment. Previously, reviewers could only see a count and local filesystem path to evidence artifacts, making visual confirmation impossible without CI runner access.

## What Was Built

- `upload_ux_evidence()` helper in `github.py` that creates a per-PR GitHub release (`ux-evidence-pr-<pr_number>`) and uploads each PNG as a release asset, returning `(label, browser_download_url)` pairs
- `_pair_evidence()` helper in `ux_ops.py` that groups `NN_before_` / `NN_after_` filenames into paired lines and renders standalone `![label](url)` for unmatched files
- Extended `format_ux_validation_comment()` with an optional `evidence_urls` parameter that renders a collapsible `<details>` block when URLs are available, falling back to the existing path-count text when not
- Integration in `adw_ux_validation.py` to call the upload after `run_ux_validate()` and pass URLs into the comment formatter, wrapped in try/except for graceful degradation
- Five new unit tests covering before/after pairing, standalone files, `None` fallback, empty-list fallback, and singular/plural screenshot count

## Technical Implementation

### Files Modified

- `adws/adw_modules/github.py`: Added `upload_ux_evidence(pr_number, sha, evidence_paths, repo)` function using `gh release create/upload` CLI commands; fetches canonical `browser_download_url` values from release JSON
- `adws/adw_modules/ux_ops.py`: Added `_pair_evidence()` helper; extended `format_ux_validation_comment()` signature with optional `evidence_urls` parameter and collapsible `<details>` rendering
- `adws/adw_ux_validation.py`: Imports `upload_ux_evidence`; after `run_ux_validate()` returns, attempts upload and passes URL list to comment formatter
- `adws/adw_tests/test_ux_validation.py`: Added five new test functions covering the extended comment format behavior
- `adws/pyproject.toml`: Added `pytest` as a dev dependency
- `adws/uv.lock`: Updated lockfile

### Key Changes

- Release tag is `ux-evidence-pr-<pr_number>` (one release per PR); asset names are the bare `basename` so `--clobber` replaces on re-run without accumulation
- `--prerelease` flag keeps UX evidence releases out of the "latest" slot and clearly marks them as automation artifacts
- Before/after pairing uses regex `^(\d+)_(before|after)_(.+)$` — the shared suffix after the ordinal prefix becomes the display name; files not matching the pattern render as standalone images
- Upload failures degrade gracefully: per-file failures log a warning and skip; full upload failure falls back to the existing `_N evidence artifact(s) captured under …_` text

## How to Use

This feature runs automatically as part of the ADW UX-validation phase. When a PR passes through `adw_ux_validation.py`:

1. The UX validator captures before/after screenshots under `agents/<adw_id>/ux_validator/`
2. Screenshots are uploaded to the `ux-evidence-pr-<pr_number>` GitHub release on the repo
3. The PR verdict comment is updated to include a collapsible **Evidence** section with inline images
4. Reviewers click the `📸 Evidence (N screenshots)` summary to expand and see before/after pairs

No manual steps are required. The feature is transparent to existing workflows — if uploads fail, the comment falls back to the previous behavior.

## Configuration

No new environment variables or configuration are required. The feature uses:
- The existing `GITHUB_TOKEN` (or `gh` CLI authentication) already required for all ADW GitHub operations
- The `gh` CLI (already available in CI and local ADW runs, version 2.x+)

## Testing

```bash
# Run Python unit tests (from repo root):
cd adws && uv run pytest adw_tests/test_ux_validation.py -v

# Or run the test file directly:
cd adws && uv run python adw_tests/test_ux_validation.py

# TypeScript type checks (JS/TS not affected, but for completeness):
npm run typecheck

# Client production build:
npm run build
```

Key test cases:
- `test_format_comment_with_evidence_urls_before_after_pair` — verifies `<details>`, `📸 Evidence`, paired `![before]`/`![after]` tags, and shared key name in output
- `test_format_comment_with_evidence_urls_singles` — verifies standalone `![label](url)` for filenames not matching the ordinal pattern
- `test_format_comment_no_urls_fallback` — verifies `_N evidence artifact(s)_` text when `evidence_urls=None`
- `test_format_comment_empty_urls_fallback` — verifies same fallback when `evidence_urls=[]`
- `test_format_comment_singular_plural` — verifies "1 screenshot" vs "3 screenshots" pluralization

## Notes

- **Private repos:** `browser_download_url` on private repos requires GitHub authentication, but GitHub renders release asset images authenticated for reviewers logged into the PR interface.
- **Optional follow-up:** Delete the `ux-evidence-pr-<n>` release on PR merge to keep releases tidy. This would require a hook in `adw_ship.py` or a separate GitHub Actions workflow step.
- **Filename convention dependency:** Before/after pairing relies on the `NN_before_` / `NN_after_` naming convention. If this changes, pairing degrades gracefully to standalone lines with no crash.
- **Asset URL robustness:** URLs are fetched from the GitHub release JSON API after upload rather than constructed from a pattern, making them robust against future GitHub URL format changes.
- AI output is preliminary; the final vendor-risk decision is always made by a human analyst.
