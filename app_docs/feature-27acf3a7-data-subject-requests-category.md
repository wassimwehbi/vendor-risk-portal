# Data Subject Requests Data Category

**ADW ID:** 27acf3a7
**Date:** 2026-05-28
**Plan-Spec:** specs/adw/issue-50-adw-27acf3a7-add-data-subject-requests-category-plan.md

## Overview

Adds `data_subject_requests` as a first-class `DataCategory` alongside existing categories like `personal`, `cross_border`, and `subprocessors`. When a vendor questionnaire mentions DSR-specific terms (DSAR, right to erasure, subject access request, etc.), the system automatically detects it, surfaces the "Data subject requests" chip in the assessment report, scores it at medium sensitivity, and triggers the GDPR applicable framework.

## What Was Built

- `data_subject_requests` added to the `DataCategory` union type (server and client)
- `DATA_CATEGORY_LABELS` entry: `data_subject_requests: 'Data subject requests'`
- 13-term keyword signal list in `CATEGORY_SIGNALS` for DSR-specific process terms
- Medium risk tier classification (1 sensitivity point) in `dataSensitivityPoints()`
- `data_subject_requests` added to `GDPR_TRIGGERS` — auto-adds GDPR to applicable frameworks
- Unit tests: detection, risk scoring, and full-pipeline scenario coverage

## Technical Implementation

### Files Modified

- `server/src/types.ts`: Added `'data_subject_requests'` to `DataCategory` union and `DATA_CATEGORY_LABELS`
- `client/src/types.ts`: Mirrored the same type and label additions on the client side
- `server/src/services/ruleEngine.ts`: Added `CATEGORY_SIGNALS` entry with 13 DSR-specific keywords
- `server/src/services/riskScoring.ts`: Added `'data_subject_requests'` to the `medium` tier array in `dataSensitivityPoints()`
- `server/src/services/aiEngine.ts`: Added `'data_subject_requests'` to the `GDPR_TRIGGERS` array
- `server/test/ruleEngineEvidence.test.ts`: New test cases for DSR term detection and non-triggering on generic "data subject" text
- `server/test/riskScoring.test.ts`: Assertions that `data_subject_requests` alone scores 1 point and combined with PHI scores 2
- `server/test/scenarios.test.ts`: Full-pipeline scenario verifying GDPR is triggered when DSR terms appear in questionnaire responses

### Key Changes

- **Type system first:** Adding the value to `DataCategory` causes TypeScript exhaustiveness checks to surface any unhandled switch branches across the full stack immediately.
- **Conservative keyword list:** Only unambiguous DSR-process terms are included (`dsar`, `right to erasure`, `right to be forgotten`, etc.). The generic term `data subject` is deliberately excluded — it already lives in the `personal` signal and would over-trigger.
- **Medium sensitivity (1 point):** DSR handling indicates compliance obligation over personal data but is not inherently high-risk data itself; it scores the same as `personal` and `cross_border`.
- **GDPR auto-trigger:** DSR handling maps directly to GDPR Arts. 15–22 (data subject rights), so detecting any DSR term automatically adds GDPR to applicable frameworks.
- **No UI work required:** The existing `DataCategoryChips` component and all views that render chips use the dynamic `DATA_CATEGORY_LABELS` record — the new chip appears automatically.

## How to Use

1. Upload or enter a vendor questionnaire that contains DSR-specific language (e.g., "We handle all DSAR requests within 30 days" or "Customers may exercise their right to erasure via our portal").
2. Run the assessment analysis as normal.
3. The assessment report will display a **"Data subject requests"** chip in the data categories section.
4. GDPR will be automatically added to the applicable frameworks section if not already present.
5. The risk score will include 1 sensitivity point for DSR handling (medium tier).

## Configuration

No configuration required. The feature is active for all new and re-analysed assessments automatically. Existing assessments will show the new category only if re-analysed — no database migration is needed since `data_categories` is stored as a JSON array of strings.

## Testing

```bash
# Biome lint + format check
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# All server unit tests (includes new DSR detection, scoring, and scenario tests)
npm --prefix server test

# Client production build
cd client && npm run build
```

Key test coverage added:
- `server/test/ruleEngineEvidence.test.ts` — verifies DSAR terms trigger detection; generic "data subject" text does not
- `server/test/riskScoring.test.ts` — verifies `['data_subject_requests']` → 1 point; `['phi', 'data_subject_requests']` → 2 points
- `server/test/scenarios.test.ts` — full-pipeline: DSR terms in responses → `data_categories` includes `'data_subject_requests'` and `applicable_frameworks` includes `'GDPR'`

## Notes

- **Existing assessments are not backfilled.** Re-running analysis will detect the new category from questionnaire text, but assessments not re-analysed will not show it. This is by design.
- **Keyword list is intentionally conservative.** If missed detections are observed, additional terms (e.g., `right to withdraw`, `erasure request`) can be appended to the `CATEGORY_SIGNALS` entry in `ruleEngine.ts`.
- As with all AI-detected categories, the `data_subject_requests` classification is preliminary. The final vendor-risk decision is always made by a human analyst.
