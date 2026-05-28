# Risk Scoring Factors: Internet-Facing + Personal Data Volume

**ADW ID:** 88164cca
**Date:** 2026-05-28
**Plan-Spec:** specs/adw/issue-47-adw-88164cca-add-risk-scoring-factors-plan.md

## Overview

Two assessment-level risk signals — whether a vendor's system is internet-facing and the volume of personal data it processes — are now first-class inputs to the preliminary risk scoring model. Analysts can declare these at assessment creation, the AI engine auto-detects them from questionnaire text during analysis, and analysts can correct auto-detected values inline on the Review Workspace. The final vendor-risk decision remains with the human analyst.

## What Was Built

- `internet_facing: boolean` scoring factor — adds +2 points per item when the vendor's service is publicly exposed
- `personal_data_volume: 'low' | 'medium' | 'high' | null` scoring factor — adds +3 / +1 / 0 pts per item
- Auto-detection via regex patterns on aggregated questionnaire text during analysis (analyst-declared values take precedence)
- "Exposure context" fieldset on the New Assessment form (checkbox + select)
- Two new summary-grid cells on the Review Workspace with inline editing and optimistic UI updates
- Non-destructive DB migration: `ensureColumn` adds both columns; existing rows default to `0` / `NULL` and score unchanged until re-analyzed
- CloudPay demo scenario updated with `internet_facing: true` and `personal_data_volume: 'high'`
- E2E test command for the new scoring signals
- UX validation specs covering both new pages and three viewports

## Technical Implementation

### Files Modified

- `server/src/services/riskScoring.ts`: Added `internetFacingPoints` and `personalDataVolumePoints` helpers; extended `ScoreInput` with the two optional fields; wired into `scoreItemPoints`
- `server/src/types.ts`: Added `PersonalDataVolume` type; added `internet_facing: boolean` and `personal_data_volume: PersonalDataVolume | null` to `Assessment`
- `client/src/types.ts`: Mirrored the same `PersonalDataVolume` type and `Assessment` field additions
- `server/src/db.ts`: Added two `ensureColumn` migrations; updated `mapAssessment` to coerce SQLite integer → boolean for `internet_facing`
- `server/src/routes/assessments.ts`: Extended `createSchema` (Zod) to accept `internet_facing` and `personal_data_volume` on `POST /assessments`
- `server/src/routes/review.ts`: Extended `assessmentSchema` (Zod) to accept both fields on `PATCH /assessments/:id`
- `server/src/services/store.ts`: Extended `CreateAssessmentInput`, `AssessmentPatch`, `createAssessment` INSERT, and `patchAssessment` dynamic SET builder
- `server/src/services/aiEngine.ts`: Added `detectExposureSignals` with regex pattern sets; wired detection into `analyzeAssessment` (step 2b); passes both factors into `scoreItem`; persists detected values to DB
- `server/src/data/scenarios/index.ts`: Extended `Scenario` interface; set explicit values on CloudPay scenario
- `server/src/services/demo.ts`: Forwarded `internet_facing` and `personal_data_volume` from scenario through `createAssessment`
- `client/src/api/client.ts`: `patchAssessment` payload now includes the two new optional fields
- `client/src/pages/NewAssessment.tsx`: Added "Exposure context" fieldset with checkbox and volume select; values included in create payload
- `client/src/pages/ReviewWorkspace.tsx`: Added `toggleInternetFacing` and `setDataVolume` handlers; added two summary-grid cells with chips and inline editing controls
- `server/test/riskScoring.test.ts`: Added five new unit tests covering internet-facing, personal data volume, combined scoring, critical-path, and regression
- `.claude/commands/e2e/test_risk_scoring_factors.md`: E2E test command for the feature

### Key Changes

- **Scoring contract** — `ScoreInput` now carries `internet_facing?: boolean` and `personal_data_volume?: PersonalDataVolume | null`. Both are assessment-level (not per-item) and passed identically to every item's `scoreItemPoints` call, consistent with how `data_categories` works today.
- **Auto-detect then override** — `detectExposureSignals` scans combined question text, responses, and vendor comments. In `analyzeAssessment`, an analyst-declared non-null value on the assessment row always wins over the detected value.
- **DB migration safety** — `ensureColumn` is idempotent; existing databases get `internet_facing = 0` (false) and `personal_data_volume = NULL` as defaults, so no existing assessment scores change until re-analysis.
- **Optimistic UI** — both `toggleInternetFacing` and `setDataVolume` call `patchAssessment` and immediately merge the returned assessment into local state, avoiding a full page reload.
- **Scoring thresholds unchanged** — Low (<3), Medium (3–4), High (5–7), Critical (≥8). Internet-facing (+2) and high volume (+3) are purely additive.

## How to Use

### At assessment creation

1. Navigate to **New Assessment** (`/assessments/new`).
2. Fill in vendor name, questionnaire type, and date.
3. In the **Exposure context (optional)** section:
   - Check **Internet-facing system** if the vendor's service is publicly accessible.
   - Choose a **Volume of personal data processed** tier: Low (< 10 k records), Medium (10 k – 1 M records), or High (> 1 M records). Leave blank if unknown.
4. Upload the questionnaire and submit.

### After analysis

1. Open the assessment's Review Workspace (`/assessments/:id`).
2. The **Internet-facing** and **Personal data volume** summary-grid cells show auto-detected or analyst-declared values.
3. If the values are incorrect:
   - Click **Mark Yes / Mark No** to toggle internet-facing.
   - Use the volume dropdown to change the tier.
4. A note confirms "Takes effect on next analysis run." Re-run analysis to recalculate item risk levels.

### Demo scenario

Load the **CloudPay** demo scenario — it ships with `internet_facing: true` and `personal_data_volume: 'high'`, which contribute to its expected `Critical` risk rating.

## Configuration

No environment variables or feature flags are required. The two DB columns are added automatically by `ensureColumn` on server start. The `internet_facing` column defaults to `0` (false) and `personal_data_volume` defaults to `NULL` for all pre-existing assessments.

## Testing

```bash
# Biome lint + format
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# Unit tests (includes 5 new scoring factor tests)
npm run test

# Client production build
npm run build
```

Run the E2E test command for end-to-end coverage of the UI and scoring signal flow:

```
/e2e:test_risk_scoring_factors
```

## Notes

- Changing `internet_facing` or `personal_data_volume` via PATCH does **not** retroactively update stored finding `risk_level` values. Re-analysis is required for scores to reflect the new values.
- Auto-detection uses keyword regex on raw text; it does not invoke Claude. Vendors that describe internet exposure or high data volume in non-standard phrasing may not be detected correctly — analysts should verify the displayed values after each analysis.
- `personal_data_volume: null` (unknown) contributes 0 points and displays as "Unknown" in the UI. This intentionally does not penalize assessments where volume has not been determined.
- As always, AI-generated preliminary scores are inputs to analyst judgement — the final vendor-risk decision is always made by a human analyst.
