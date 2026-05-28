# Spec — Add "Data subject requests" as a detectable data category

- **Status:** Draft
- **Branch:** feat-issue-50-adw-27acf3a7-add-data-subject-requests-category
- **Location:** `server/src/types.ts`, `server/src/services/ruleEngine.ts`, `server/src/services/riskScoring.ts`, `server/src/services/aiEngine.ts`, `client/src/types.ts`, `server/test/ruleEngineEvidence.test.ts`, `server/test/riskScoring.test.ts`, `server/test/scenarios.test.ts`
- **Related docs:** `specs/0005-rule-engine.md` (if present), `README.md`, `API_CONTRACT.md`

## Problem / Objective

**User Story:** As an analyst reviewing a vendor assessment, I want the system to automatically detect and surface whether the vendor handles data-subject requests (DSR), so that I can see this processing characteristic alongside personal/sensitive/PHI/cross-border/subprocessors without having to manually check.

**Problem Statement:** The `DataCategory` enum (`server/src/types.ts:85-93`) currently has 8 values covering what types of regulated data a vendor processes. Data-subject request handling exists as a *control domain* (`dsr`) used for gap analysis and follow-up questions, but it is not a `DataCategory`, so the AI never flags it in the "data processed" section of the assessment report. Req 4D from the Ines spec requires it to be detectable and shown like the other categories.

## Approach & Changes

DSR handling sits alongside `cross_border` and `subprocessors` as a **processing characteristic** rather than a raw data type. When a vendor questionnaire response mentions DSR-specific terms (`dsar`, `right to erasure`, `subject access request`, etc.), the system should detect it, add it to the assessment's `data_categories`, surface it in the report chips, and include it as a GDPR trigger.

**Files and why they matter:**

- **`server/src/types.ts`** — The authoritative `DataCategory` union type and `DATA_CATEGORY_LABELS` record. Adding `'data_subject_requests'` here makes it a first-class category throughout the stack.
- **`server/src/services/ruleEngine.ts`** — `CATEGORY_SIGNALS` drives keyword detection. A new entry with DSR-specific terms is added here. Careful not to duplicate `'data subject'` which already lives in the `personal` signal — use only terms specific to DSR *processes* (e.g. `dsar`, `right to erasure`).
- **`server/src/services/riskScoring.ts`** — `dataSensitivityPoints()` classifies categories into high/medium/none. DSR belongs in the `medium` tier alongside `personal` and `cross_border` (vendors handling DSRs are processing personal data under a compliance obligation — the presence of DSR processes is a compliance indicator, not inherently high-risk on its own).
- **`server/src/services/aiEngine.ts`** — `GDPR_TRIGGERS` array. DSR handling is a core GDPR right (Arts. 15–22), so detecting it should auto-add the GDPR framework to the report.
- **`client/src/types.ts`** — Mirror of the server `DataCategory` type and `DATA_CATEGORY_LABELS`. Must be kept in sync with the server definition.
- **`server/test/ruleEngineEvidence.test.ts`** — Unit tests for `detectDataCategories`. New test cases verify DSR terms are detected.
- **`server/test/riskScoring.test.ts`** — Tests for `dataSensitivityPoints`. New assertions verify `data_subject_requests` scores 1 point.
- **`server/test/scenarios.test.ts`** — Full-pipeline scenario tests. Verify GDPR is triggered when DSR is detected.

### Implementation Plan

**Phase 1 — Foundation (type system):** Add `'data_subject_requests'` to the `DataCategory` union and `DATA_CATEGORY_LABELS` on both server and client. This is load-bearing — TypeScript strict mode will surface every exhaustiveness gap across the codebase so nothing is missed.

**Phase 2 — Core detection:** Add the `CATEGORY_SIGNALS` entry in `ruleEngine.ts` with DSR-specific keywords. Update `dataSensitivityPoints()` in `riskScoring.ts` to include the new category in the medium tier. Add `data_subject_requests` to `GDPR_TRIGGERS` in `aiEngine.ts`.

**Phase 3 — Tests & verification:** Add unit tests for detection and scoring. Run the full test suite to confirm zero regressions.

### Step by Step Tasks

#### Step 1 — Update server `DataCategory` type and labels

- In `server/src/types.ts`, add `'data_subject_requests'` to the `DataCategory` union (after `subprocessors`, line 93).
- In `server/src/types.ts`, add the label `data_subject_requests: 'Data subject requests'` to `DATA_CATEGORY_LABELS`.

#### Step 2 — Update client `DataCategory` type and labels

- In `client/src/types.ts`, add `'data_subject_requests'` to the `DataCategory` union (after `subprocessors`, line 80).
- In `client/src/types.ts`, add the label `data_subject_requests: 'Data subject requests'` to `DATA_CATEGORY_LABELS`.

#### Step 3 — Add detection signals to `ruleEngine.ts`

- In `server/src/services/ruleEngine.ts`, insert a new entry in `CATEGORY_SIGNALS` (after the `subprocessors` entry, before `personal`):
  ```ts
  {
    category: 'data_subject_requests',
    terms: [
      'dsar',
      'data subject access request',
      'data subject request',
      'subject access request',
      'right to access',
      'right to erasure',
      'right to be forgotten',
      'right to rectification',
      'right to portability',
      'right to object',
      'right to restrict',
      'data deletion request',
      'withdrawal of consent',
    ],
  },
  ```
  Note: do NOT include `'data subject'` alone — it already lives in the `personal` signal and would over-trigger.

#### Step 4 — Update risk scoring sensitivity bucket

- In `server/src/services/riskScoring.ts`, add `'data_subject_requests'` to the `medium` array inside `dataSensitivityPoints()`:
  ```ts
  const medium: DataCategory[] = ['personal', 'cross_border', 'data_subject_requests'];
  ```
  Rationale: DSR handling implies personal data processing (compliance obligation), but is not itself high-sensitivity data — 1 point is proportionate.

#### Step 5 — Add `data_subject_requests` to GDPR triggers

- In `server/src/services/aiEngine.ts`, add `'data_subject_requests'` to the `GDPR_TRIGGERS` array:
  ```ts
  const GDPR_TRIGGERS: DataCategory[] = [
    'personal',
    'sensitive_personal',
    'children',
    'employee',
    'cross_border',
    'subprocessors',
    'data_subject_requests',
  ];
  ```

#### Step 6 — Add unit tests for detection

- In `server/test/ruleEngineEvidence.test.ts`, add test cases verifying:
  - `detectDataCategories('The vendor has a DSAR process')` includes `'data_subject_requests'`
  - `detectDataCategories('we support the right to erasure')` includes `'data_subject_requests'`
  - `detectDataCategories('subject access request handled within 30 days')` includes `'data_subject_requests'`
  - Generic personal data text without DSR terms does NOT produce `'data_subject_requests'`

#### Step 7 — Add unit tests for risk scoring

- In `server/test/riskScoring.test.ts`, add assertions:
  - `dataSensitivityPoints(['data_subject_requests'])` returns `1`
  - `dataSensitivityPoints(['phi', 'data_subject_requests'])` returns `2` (high tier wins)

#### Step 8 — Verify GDPR trigger in scenario tests

- In `server/test/scenarios.test.ts`, add or extend a scenario where questionnaire responses mention DSR terms, and assert that `data_categories` includes `'data_subject_requests'` and `applicable_frameworks` includes `'GDPR'`.

#### Step 9 — Run validation commands

- Run all commands in the Validation Commands section and confirm zero errors.

## Key Decisions & Rationale

1. **DSR as a processing characteristic, not a data type.** `cross_border` and `subprocessors` already established the pattern of categories that describe *how* data is processed, not just what type it is. DSR handling fits the same pattern — it is a processing obligation, not a data sensitivity level.

2. **Medium risk tier (1 point), not high (2 points).** PHI, sensitive personal, financial, and children's data are high-risk because the data itself is inherently sensitive. DSR handling indicates personal data processing but the *presence* of DSR processes is actually a compliance positive. Scoring it the same as `personal` (1 point) is appropriate.

3. **Adding `data_subject_requests` to `GDPR_TRIGGERS`.** GDPR Arts. 15–22 define data subject rights. If a vendor explicitly mentions DSAR handling, right to erasure, etc., they are operating in a GDPR context. This auto-adds GDPR to applicable frameworks, consistent with how `personal`, `cross_border`, etc. trigger GDPR.

4. **Avoiding over-triggering on "data subject".** The term `data subject` is already in the `personal` signal. Using it in the DSR signal too would cause every GDPR-aware questionnaire to show the `data_subject_requests` chip, which would be misleading (simply processing personal data does not mean DSR handling was assessed). Only unambiguous DSR-process terms (`dsar`, `right to erasure`, `subject access request`, etc.) are used.

5. **No schema migration required.** `data_categories` is stored as a JSON array of strings. Adding a new valid string value requires no database schema change — only re-running analysis on existing assessments will produce the new category for them, which is the expected behaviour.

6. **Client type mirror is kept in sync manually.** The client `types.ts` is a hand-maintained mirror of the server types. Both must be updated in the same commit to keep the TypeScript strict-mode build green.

## Verification

### Unit Tests & Edge Cases

- **DSR term detection:** `dsar`, `right to erasure`, `right to be forgotten`, `subject access request`, `right to rectification`, `right to portability`, `right to object`, `right to restrict`, `data deletion request`, `withdrawal of consent` — each must trigger `'data_subject_requests'`.
- **No over-triggering:** Text containing only `data subject` (without DSR-process terms) must NOT add `'data_subject_requests'` (it would already add `'personal'`).
- **Risk scoring — medium tier:** `dataSensitivityPoints(['data_subject_requests'])` → 1; combined with high-tier category → 2.
- **GDPR trigger:** Assessment with DSR-only signals in responses → `applicable_frameworks` includes `'GDPR'`.
- **TypeScript exhaustiveness:** No `never` / unmatched branch errors in `riskScoring.ts` or any switch on `DataCategory`.

### Acceptance Criteria

- `DataCategory` union in `server/src/types.ts` and `client/src/types.ts` both include `'data_subject_requests'`.
- `DATA_CATEGORY_LABELS` on both server and client maps `data_subject_requests` → `'Data subject requests'`.
- `CATEGORY_SIGNALS` in `ruleEngine.ts` contains an entry for `'data_subject_requests'` with at least the terms: `dsar`, `right to erasure`, `right to be forgotten`, `data subject request`, `subject access request`.
- `dataSensitivityPoints(['data_subject_requests'])` returns `1`.
- `GDPR_TRIGGERS` in `aiEngine.ts` includes `'data_subject_requests'`.
- `detectDataCategories('The vendor handles all DSAR requests within 30 days')` includes `'data_subject_requests'`.
- All server unit tests pass with zero failures.
- `npm run build` (client) succeeds with zero TypeScript errors.
- `npm run check` (Biome lint) passes with zero violations.

### Validation Commands

```bash
# Biome lint + format
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# All server + client unit tests
npm run test

# Client production build
npm run build
```

## Known Limitations / Follow-ups

- **Existing assessments are not backfilled.** Re-running analysis on a pre-existing assessment will detect `data_subject_requests` if the questionnaire responses contain the terms, but assessments that are not re-analysed will not show the new category. This is by design — the category reflects what the AI detected from the actual questionnaire text.
- **Keyword list is conservative.** The signal list deliberately excludes the generic `data subject` term to prevent false positives. If teams observe missed detections, additional terms (e.g., `right to withdraw`, `erasure request`) can be appended to `CATEGORY_SIGNALS` in a follow-up patch.
- **No UI-specific work required.** The `DataCategoryChips` component in `client/src/components/ui.tsx` and all pages that render chips (`ReportView.tsx`, `ReviewWorkspace.tsx`, `DemoShowcase.tsx`) all use the dynamic `DATA_CATEGORY_LABELS` record — the new category will appear automatically once the label is added.
