# Spec — Patch: Fix upload_ux_evidence asset-name tracking so screenshots embed

- **Status:** Draft
- **Branch:** feat-issue-36-adw-1c410c6f-embed-ux-evidence-screenshots
- **Location:** `adws/adw_modules/github.py`
- **Related docs:** `specs/adw/issue-36-adw-1c410c6f-embed-ux-evidence-screenshots-plan.md`

## Problem / Objective

**Original Spec:** `specs/adw/issue-36-adw-1c410c6f-embed-ux-evidence-screenshots-plan.md`

**Issue:** In `upload_ux_evidence` (github.py lines 499–545), `asset_name = f"{sha8}_{basename}"` is computed on line 502 but is never passed to `gh release upload`. The `gh` CLI receives the original file `path`, so GitHub stores the asset under the plain `basename`. However, `uploaded_names.add(asset_name)` (line 513) records the sha8-prefixed name. When the release JSON is fetched, asset names are plain basenames, so `name in uploaded_names` on line 539 never matches — `urls` is always `[]` and `format_ux_validation_comment` always falls back to the path-count text. Inline screenshots are never embedded.

**Solution:** Option (b) from the review: fix the tracking set to store plain basenames. Remove the dead `asset_name` variable, use `uploaded_names.add(basename)`, and clean up the now-unnecessary sha8 prefix stripping in the URL-collection loop.

## Approach & Changes

### Files to Modify

- `adws/adw_modules/github.py` — 4 lines changed in `upload_ux_evidence`

### Implementation Steps

#### Step 1: Remove dead `asset_name` variable and fix tracking

In the per-file upload loop (lines 500–513):

- **Remove** the line `asset_name = f"{sha8}_{basename}"` (line 502) — it is computed but never used as the upload filename.
- **Change** `uploaded_names.add(asset_name)` → `uploaded_names.add(basename)` so the tracking set stores the name that GitHub actually assigns to the asset.

#### Step 2: Clean up the URL-collection loop

In the URL-collection loop (lines 535–543):

- **Remove** `prefix = sha8 + "_"` (line 536) — no longer needed since asset names are plain basenames.
- **Simplify** the label assignment: replace `label = name[len(prefix):] if name.startswith(prefix) else name` with `label = name` — assets are already named by their basename, no stripping required.

#### Step 3: Update the docstring

- Remove the now-incorrect claim "Asset names: `<sha8>_<basename>` (idempotent with --clobber)". Replace with "Asset names: `<basename>` (idempotent with --clobber per per-PR tag)".

## Key Decisions & Rationale

**Lines of code to change:** ~5 (remove 2, change 2, update 1 docstring line)
**Risk level:** low — change is entirely within `upload_ux_evidence`; no caller signatures change; fallback path unchanged
**Testing required:** Existing unit tests in `adws/adw_tests/test_ux_validation.py` must still pass; no new tests needed since this is a one-line logic fix to tracking already covered by the existing test assertions on the returned URL list

## Verification

Execute every command to validate the patch is complete with zero regressions.

```bash
# Python unit tests (includes test_ux_validation.py)
cd adws && uv run pytest adw_tests/test_ux_validation.py -v

# TypeScript type checks + client build (no regressions in JS layer)
npm run typecheck
npm run build

# Biome lint + format
npm run check
```

## Known Limitations / Follow-ups

- The sha8 prefix in asset names was intended to provide content-addressability within a single PR release. Removing it means re-runs with different SHAs will clobber the previous run's assets under the same name — this is acceptable and is exactly what `--clobber` is for (per the original spec rationale for keying the tag by PR number, not SHA).
- The sha8 is still available on the `sha` parameter if a future follow-up wants to encode it differently (e.g., in the release notes rather than the asset name).
