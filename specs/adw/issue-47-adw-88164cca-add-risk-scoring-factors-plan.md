# Spec — Add Risk-Scoring Factors: Internet-Facing System + Volume of Personal Data

- **Status:** Draft
- **Branch:** feat-issue-47-adw-88164cca-add-risk-scoring-factors
- **Location:** `server/src/services/riskScoring.ts`, `server/src/types.ts`, `client/src/types.ts`, `server/src/db.ts`, `server/src/routes/assessments.ts`, `server/src/routes/review.ts`, `server/src/services/store.ts`, `server/src/services/aiEngine.ts`, `server/src/data/scenarios/index.ts`, `server/src/services/demo.ts`, `client/src/pages/NewAssessment.tsx`, `client/src/pages/ReviewWorkspace.tsx`, `server/test/riskScoring.test.ts`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md` (§5 scoring model), `API_CONTRACT.md`, `specs/adw/issue-46-adw-29502dfe-complete-evidence-sufficiency-detection-plan.md`

## Problem / Objective

**User Story:** As a security analyst, I want the risk score to reflect whether a vendor's system is internet-facing and the volume of personal data it processes — so that the preliminary risk level correctly accounts for exposure and scale, and I do not need to manually compensate for these factors when overriding findings.

**Problem Statement:** Ines spec Req 5 defines a weighted scoring table that includes two factors the model currently ignores:

| Factor | Weight | Current state |
|--------|--------|---------------|
| Internet-facing system | Medium | Appears only in CloudPay scenario prose (`scenarios/index.ts:268`); never a scoring input |
| Volume of personal data | High | Collapsed into a binary sensitivity tier (`riskScoring.ts:54-60`); volume (quantity of records) is not represented |

`ScoreInput` (`server/src/services/riskScoring.ts:62-68`) and `scoreItemPoints` (`:70-83`) have no `internet_facing` or `personal_data_volume` field. The `Assessment` model and the `assessments` DB table have no corresponding columns. The missing factors mean the preliminary score under-estimates risk for internet-exposed, high-volume vendors, burdening analysts with manual overrides.

## Approach & Changes

Add two assessment-level scoring signals as first-class fields on `Assessment`:

- `internet_facing: boolean` — +2 pts per item when `true` (Medium weight per Ines spec)
- `personal_data_volume: 'low' | 'medium' | 'high' | null` — +3 / +1 / +0 pts per item (High weight per Ines spec)

These are captured in three ways:
1. **At creation** — the analyst (or submitter) can declare them in the new-assessment form.
2. **Auto-detected at analysis time** — `aiEngine.ts` scans aggregated questionnaire text for internet-facing and volume signals and writes detected values to the assessment.
3. **Post-analysis override** — the analyst can correct the auto-detected values via PATCH `/assessments/:id`, which re-triggers score recomputation on the next analysis run.

**Relevant files and why they matter:**
- `server/src/services/riskScoring.ts` — `ScoreInput` and `scoreItemPoints` are the scoring contract; both need the two new fields.
- `server/src/types.ts` — `Assessment` and shared enums are the source of truth for server types.
- `client/src/types.ts` — Client mirror of `Assessment`; must stay in sync.
- `server/src/db.ts` — SQLite schema + `mapAssessment`; columns added via `ensureColumn` migration so existing DBs are not broken.
- `server/src/routes/assessments.ts` — `createSchema` (Zod) gates the POST body; must accept the two new optional fields.
- `server/src/routes/review.ts` — `assessmentSchema` (Zod) gates PATCH body; must accept the two new optional fields so analysts can correct them.
- `server/src/services/store.ts` — `CreateAssessmentInput`, `AssessmentPatch`, `createAssessment`, `patchAssessment`, and `mapAssessment` all need the new fields.
- `server/src/services/aiEngine.ts` — Passes `ScoreInput` to `scoreItem`; must pass the new fields. Also hosts the auto-detection logic.
- `server/src/data/scenarios/index.ts` — `Scenario` interface and CloudPay scenario must declare `internet_facing` + `personal_data_volume` so demo loads carry correct metadata.
- `server/src/services/demo.ts` — `loadScenario` calls `createAssessment`; must forward the scenario's new fields.
- `client/src/pages/NewAssessment.tsx` — Add optional "Exposure context" section so analysts can declare both signals at creation.
- `client/src/pages/ReviewWorkspace.tsx` — Surface the two fields in the summary grid; allow analyst to edit them inline (PATCH).
- `server/test/riskScoring.test.ts` — New test cases covering the two scoring factors and regression.

### New Files

- `.claude/commands/e2e/test_risk_scoring_factors.md` — E2E test for the new scoring signals (internet-facing flag + volume select visible in UI, score reflects values).

### Implementation Plan

**Phase 1 — Foundation: types, scoring, DB**
Add `PersonalDataVolume` type and update `Assessment`; extend `ScoreInput` with the two new fields and update `scoreItemPoints`; add DB columns via `ensureColumn`; update `mapAssessment`.

**Phase 2 — Core: routes, store, detection**
Update Zod schemas in `assessments.ts` and `review.ts`; update `store.ts` service functions; add `detectExposureSignals` to `aiEngine.ts` and wire into the analysis pipeline; update CloudPay scenario and `demo.ts`.

**Phase 3 — UI + tests**
Add form controls in `NewAssessment.tsx`; add display/edit cells in `ReviewWorkspace.tsx`; write unit tests; write E2E test file; run all validation commands.

### Step by Step Tasks

#### Step 1 — Read key files before editing

- Read `server/src/services/riskScoring.ts` in full to confirm current line layout.
- Read `server/src/types.ts` lines 185–206 to confirm the `Assessment` interface.
- Read `client/src/types.ts` lines 1–60 to confirm the client mirror.
- Read `server/src/db.ts` lines 190–200 to confirm the `ensureColumn` migration pattern.
- Read `.claude/commands/test_e2e.md` and `.claude/commands/e2e/test_basic_assessment.md` to understand the E2E test format before writing the new test file.

#### Step 2 — Update shared types (`server/src/types.ts` + `client/src/types.ts`)

In `server/src/types.ts`:
- Add `PersonalDataVolume` type after the existing simple types:
  ```typescript
  export type PersonalDataVolume = 'low' | 'medium' | 'high';
  ```
- Add two fields to the `Assessment` interface after `data_categories`:
  ```typescript
  internet_facing: boolean;
  personal_data_volume: PersonalDataVolume | null;
  ```

In `client/src/types.ts`:
- Mirror the exact same `PersonalDataVolume` type and `Assessment` field additions.

#### Step 3 — Update scoring service (`server/src/services/riskScoring.ts`)

- Add a new factor-comment line to the header JSDoc:
  ```
  *   - Internet-facing system:  true +2; false 0
  *   - Personal data volume:   high +3; medium +1; low/null 0
  ```
- Extend `ScoreInput` with two optional fields:
  ```typescript
  export interface ScoreInput {
    control_strength: ControlStrength;
    evidence_sufficiency: EvidenceSufficiency;
    completeness: Completeness;
    data_categories: DataCategory[];
    control_domain: string;
    internet_facing?: boolean;
    personal_data_volume?: PersonalDataVolume | null;
  }
  ```
- Add two helper functions after `dataSensitivityPoints`:
  ```typescript
  function internetFacingPoints(internet_facing?: boolean): number {
    return internet_facing ? 2 : 0;
  }

  function personalDataVolumePoints(volume?: PersonalDataVolume | null): number {
    if (volume === 'high') return 3;
    if (volume === 'medium') return 1;
    return 0;
  }
  ```
- Update `scoreItemPoints` to include the two new helpers:
  ```typescript
  export function scoreItemPoints(input: ScoreInput): number {
    let points = 0;
    points += STRENGTH_POINTS[input.control_strength];
    points += EVIDENCE_POINTS[input.evidence_sufficiency];
    points += COMPLETENESS_POINTS[input.completeness];
    if (
      CRITICAL_DOMAINS.has(input.control_domain) &&
      (input.control_strength === 'None' || input.control_strength === 'Weak')
    ) {
      points += 2;
    }
    points += dataSensitivityPoints(input.data_categories);
    points += internetFacingPoints(input.internet_facing);
    points += personalDataVolumePoints(input.personal_data_volume);
    return points;
  }
  ```
- Import `PersonalDataVolume` from `'../types'`.

#### Step 4 — DB migration and mapper (`server/src/db.ts`)

- In `initDb()`, after the existing `ensureColumn` calls, add two new migrations:
  ```typescript
  ensureColumn('assessments', 'internet_facing', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('assessments', 'personal_data_volume', 'TEXT');
  ```
- Update `mapAssessment` to include the new fields:
  ```typescript
  internet_facing: row.internet_facing === 1 || row.internet_facing === true,
  personal_data_volume: (row.personal_data_volume ?? null) as PersonalDataVolume | null,
  ```
- Add `PersonalDataVolume` to the import from `'./types'`.

#### Step 5 — Update `store.ts`

- Extend `CreateAssessmentInput`:
  ```typescript
  export interface CreateAssessmentInput {
    vendor_name: string;
    questionnaire_type: string;
    date_submitted: string;
    internet_facing?: boolean;
    personal_data_volume?: PersonalDataVolume | null;
  }
  ```
- Update `createAssessment` INSERT to include the new columns (SQLite stores booleans as integers):
  ```typescript
  `INSERT INTO assessments (vendor_id, tenant_id, created_by, questionnaire_type, date_submitted,
     internet_facing, personal_data_volume, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)`
  .run(vendorId, tenantId, scope.actor, input.questionnaire_type, input.date_submitted,
       input.internet_facing ? 1 : 0,
       input.personal_data_volume ?? null,
       nowIso())
  ```
- Extend `AssessmentPatch`:
  ```typescript
  export interface AssessmentPatch {
    overall_risk?: RiskLevel;
    analyst_notes?: string;
    validation_status?: 'pending' | 'approved';
    internet_facing?: boolean;
    personal_data_volume?: PersonalDataVolume | null;
  }
  ```
- Update `patchAssessment` to handle the two new optional fields — add them to the dynamic `sets` / `params` construction in the same pattern as `overall_risk` and `analyst_notes`.
- Import `PersonalDataVolume` from `'../types'`.

#### Step 6 — Update route schemas

In `server/src/routes/assessments.ts`, extend `createSchema`:
```typescript
const createSchema = z.object({
  vendor_name: z.string().min(1, 'vendor_name is required'),
  questionnaire_type: z.string().min(1).default('SIG'),
  date_submitted: z.string().min(1),
  internet_facing: z.boolean().optional(),
  personal_data_volume: z.enum(['low', 'medium', 'high']).optional(),
});
```

In `server/src/routes/review.ts`, extend `assessmentSchema`:
```typescript
const assessmentSchema = z.object({
  overall_risk: riskEnum.optional(),
  analyst_notes: z.string().optional(),
  validation_status: z.enum(['pending', 'approved']).optional(),
  internet_facing: z.boolean().optional(),
  personal_data_volume: z.enum(['low', 'medium', 'high']).nullish(),
});
```

#### Step 7 — Wire new factors into analysis pipeline (`server/src/services/aiEngine.ts`)

Add a `detectExposureSignals` function to auto-detect the two signals from aggregated questionnaire text:

```typescript
const INTERNET_FACING_PATTERNS = [
  /internet[- ]facing/i,
  /publicly accessible/i,
  /public[- ]facing/i,
  /external[- ]users/i,
  /public api/i,
  /web application/i,
  /exposed to the internet/i,
  /accessible from the internet/i,
];

const HIGH_VOLUME_PATTERNS = [
  /million[s]? (of )?(record|user|customer|individual)/i,
  /billion[s]? (of )?(record|user|customer|individual)/i,
  /large (volume|scale|dataset)/i,
  /high volume/i,
];

const MEDIUM_VOLUME_PATTERNS = [
  /thousand[s]? (of )?(record|user|customer|individual)/i,
  /hundred[s]? of thousand/i,
  /moderate volume/i,
];

function detectExposureSignals(items: QuestionnaireItem[]): {
  internet_facing: boolean;
  personal_data_volume: 'low' | 'medium' | 'high' | null;
} {
  const combined = items
    .map((i) => `${i.question_text} ${i.response} ${i.vendor_comments ?? ''}`)
    .join('\n')
    .toLowerCase();

  const internet_facing = INTERNET_FACING_PATTERNS.some((p) => p.test(combined));

  let personal_data_volume: 'low' | 'medium' | 'high' | null = null;
  if (HIGH_VOLUME_PATTERNS.some((p) => p.test(combined))) {
    personal_data_volume = 'high';
  } else if (MEDIUM_VOLUME_PATTERNS.some((p) => p.test(combined))) {
    personal_data_volume = 'medium';
  }

  return { internet_facing, personal_data_volume };
}
```

In `analyzeAssessment`:
- After step 2 (aggregate data categories), add step 2b:
  ```typescript
  // 2b) Detect exposure signals from questionnaire text.
  const detected = detectExposureSignals(items);
  // Prefer any analyst-declared value already on the assessment over auto-detected.
  const internet_facing: boolean =
    assessmentRow.internet_facing != null
      ? Boolean(assessmentRow.internet_facing)
      : detected.internet_facing;
  const personal_data_volume: PersonalDataVolume | null =
    assessmentRow.personal_data_volume ?? detected.personal_data_volume;
  ```
- In step 3 (recompute risk per item), pass the new factors:
  ```typescript
  a.analysis.risk_level = scoreItem({
    control_strength: a.analysis.control_strength,
    evidence_sufficiency: a.analysis.evidence_sufficiency,
    completeness: a.analysis.completeness,
    data_categories,
    control_domain: a.analysis.control_domain,
    internet_facing,
    personal_data_volume,
  });
  ```
- In the transaction persist step (UPDATE assessments), add the two new columns to the SET clause:
  ```typescript
  internet_facing = @internet_facing,
  personal_data_volume = @personal_data_volume,
  ```
  And pass the values in the run params.
- Import `PersonalDataVolume` from `'../types'`.

#### Step 8 — Update demo scenarios (`server/src/data/scenarios/index.ts`)

Extend `Scenario` interface with optional fields:
```typescript
export interface Scenario {
  key: string;
  vendor_name: string;
  sector: string;
  questionnaire_type: string;
  expected_risk: RiskLevel;
  summary: string;
  data_categories: DataCategory[];
  items: NewQuestionnaireItem[];
  internet_facing?: boolean;
  personal_data_volume?: 'low' | 'medium' | 'high';
}
```

Update the CloudPay scenario declaration to add:
```typescript
internet_facing: true,
personal_data_volume: 'high',
```

Update `server/src/services/demo.ts` — pass the new fields through `createAssessment`:
```typescript
const assessment = createAssessment(
  {
    vendor_name: scenario.vendor_name,
    questionnaire_type: scenario.questionnaire_type,
    date_submitted: new Date().toISOString().slice(0, 10),
    internet_facing: scenario.internet_facing,
    personal_data_volume: scenario.personal_data_volume,
  },
  scope,
);
```

#### Step 9 — Update `NewAssessment.tsx` (UI capture at creation)

Below the existing date field, add an optional "Exposure context" fieldset. Follow the design-system patterns (`label`, `input`, `select`, card spacing):
- A checkbox labelled "Internet-facing system" (hint text: "Vendor's service is accessible from the public internet")
- A select labelled "Volume of personal data processed" with options: `— unknown —` (empty), `Low (< 10 k records)`, `Medium (10 k – 1 M records)`, `High (> 1 M records)`

Wire the two state values into the `api.createAssessment` call payload.

#### Step 10 — Update `ReviewWorkspace.tsx` (display + inline edit)

In the 4-cell summary grid (lines ~250–295), add two new cells after "Applicable frameworks":

**Cell 5 — Internet-facing:**
- Label: "Internet-facing"
- Display: a `Yes` / `No` / `Unknown` chip
- When `canEdit && analyzed`: toggle button to flip the value (calls `patchAssessment({ internet_facing: !current })`)

**Cell 6 — Personal data volume:**
- Label: "Personal data volume"
- Display: `High` / `Medium` / `Low` / `Unknown` chip
- When `canEdit && analyzed`: a `<select>` (options: `unknown`, `low`, `medium`, `high`) that calls `patchAssessment({ personal_data_volume: value })` on change

After a successful PATCH, update the local `assessment` state so the UI reflects the new values without a full page reload. Note to the analyst (tooltip or caption): "Changing these values takes effect on the next analysis run." The score already stored in existing findings will not retroactively change until re-analysis.

#### Step 11 — Create E2E test file

Create `.claude/commands/e2e/test_risk_scoring_factors.md` following the format of `.claude/commands/e2e/test_basic_assessment.md`. The test should:
1. Load the CloudPay demo scenario (already has `internet_facing: true`, `personal_data_volume: 'high'`).
2. Verify the "Internet-facing" cell shows "Yes" and "Personal data volume" shows "High" in the summary grid.
3. Run AI analysis.
4. Verify the overall risk is "Critical" (CloudPay's existing control gaps + new factors guarantee it).
5. Toggle internet-facing off via the UI.
6. Verify the cell now shows "No" and a note that re-analysis is needed.
7. Take a screenshot as evidence.

#### Step 12 — Add unit tests (`server/test/riskScoring.test.ts`)

Add the following new test cases after the existing tests:

```typescript
test('internet-facing adds 2 pts (Medium weight)', () => {
  const withExposure = scoreItemPoints({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: [],
    control_domain: 'MFA',
    internet_facing: true,
  });
  assert.equal(withExposure, 2);

  const withoutExposure = scoreItemPoints({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: [],
    control_domain: 'MFA',
    internet_facing: false,
  });
  assert.equal(withoutExposure, 0);
});

test('personal_data_volume high adds 3 pts, medium adds 1 pt', () => {
  const base = {
    control_strength: 'Strong' as const,
    evidence_sufficiency: 'Sufficient' as const,
    completeness: 'Complete' as const,
    data_categories: [] as DataCategory[],
    control_domain: 'Data Privacy Governance',
  };
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: 'high' }), 3);
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: 'medium' }), 1);
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: 'low' }), 0);
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: null }), 0);
  assert.equal(scoreItemPoints({ ...base }), 0); // undefined = 0
});

test('well-controlled internet-facing system with high personal data volume scores High', () => {
  const level = scoreItem({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: ['personal'],
    control_domain: 'MFA',
    internet_facing: true,
    personal_data_volume: 'high',
  });
  // 0+0+0+0+1(personal)+2(internet)+3(high-volume) = 6 → High
  assert.equal(level, 'High');
});

test('absent MFA on internet-facing PHI vendor with high volume is Critical', () => {
  const level = scoreItem({
    control_strength: 'None',
    evidence_sufficiency: 'None',
    completeness: 'Missing',
    data_categories: ['phi'],
    control_domain: 'MFA',
    internet_facing: true,
    personal_data_volume: 'high',
  });
  // 4+2+3+2(critical penalty)+2(phi)+2(internet)+3(high-volume) = 18 → Critical
  assert.equal(level, 'Critical');
});

test('existing tests are unaffected when new fields are absent', () => {
  // Regression: omitting new fields must yield the same result as before this change.
  const level = scoreItem({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: ['personal'],
    control_domain: 'MFA',
    // internet_facing and personal_data_volume intentionally omitted
  });
  assert.equal(level, 'Low'); // 0+0+0+0+1 = 1 → Low (unchanged)
});
```

Import `DataCategory` at the top of the test file if it is not already imported.

#### Step 13 — Run validation commands

Run all commands listed in the Validation section to confirm zero regressions.

## Key Decisions & Rationale

**Assessment-level (not per-item) signals.** `internet_facing` and `personal_data_volume` describe the vendor's system, not individual controls. They are stored on the `Assessment` row and passed into every item's `ScoreInput` identically — the same pattern as `data_categories` today. This avoids per-item duplication and keeps the scoring contract consistent.

**Auto-detect then allow analyst override.** Running keyword detection during analysis means analysts get a pre-filled value on first analysis without extra steps. Storing the value on the assessment (not ephemeral) lets analysts correct it via PATCH before re-running analysis. This preserves human-in-the-loop control: the AI suggests, the analyst confirms.

**Analyst-declared value wins over auto-detection.** `aiEngine.ts` checks `assessmentRow.internet_facing != null` before falling back to the detected value. A `false` declared at creation (or via PATCH) will suppress auto-detection, ensuring explicit analyst intent is never silently overridden.

**`ensureColumn` migration.** Existing databases without the new columns default to `internet_facing = 0` (false) and `personal_data_volume = NULL`. This means existing assessments are unaffected until re-analyzed, and the scoring model degrades gracefully to pre-feature behavior.

**No threshold change.** The thresholds (Low <3, Medium 3–4, High 5–7, Critical ≥8) remain unchanged. Internet-facing (+2) and high volume (+3) are additive factors. A Strong/Sufficient/Complete control with personal data, internet-facing, high volume scores 6 pts → High, which is appropriate for a well-controlled but high-exposure system.

**No separate `PersonalDataVolume` field on `ScoreInput` for "unknown".** `null` and `undefined` both produce 0 points, so unknown volume does not penalize. This avoids artificially inflating risk for assessments where volume has not been determined.

**CloudPay scenario carries explicit values; other scenarios rely on detection.** CloudPay's sector description already mentions "internet-facing payment platform" and the items discuss high transaction volumes. Setting `internet_facing: true` and `personal_data_volume: 'high'` explicitly on the scenario ensures the expected_risk=Critical regression test remains deterministic even if detection patterns change.

**UI caption on PATCH.** Editing `internet_facing` or `personal_data_volume` after analysis does not retroactively update stored finding risk levels. The note in the UI ("takes effect on next analysis run") prevents analyst confusion.

## Verification

### Unit Tests & Edge Cases

- `internet_facing: true` with otherwise perfect controls adds exactly 2 pts.
- `internet_facing: false` (explicit) and `internet_facing: undefined` (omitted) both add 0 pts.
- `personal_data_volume: 'high'` adds 3 pts; `'medium'` adds 1 pt; `'low'` and `null` and `undefined` add 0 pts.
- Combined: Strong/Sufficient/Complete + personal + internet_facing + high volume = 1+2+3 = 6 → High.
- Critical path: None/None/Missing + PHI + critical domain penalty + internet_facing + high volume = 4+2+3+2+2+2+3 = 18 → Critical.
- Regression: all 7 existing `riskScoring.test.ts` tests pass unchanged (new fields omitted → 0 contribution).
- `mapAssessment`: `internet_facing` stored as integer (0/1) maps to boolean correctly.

### Acceptance Criteria

1. `ScoreInput` includes `internet_facing?: boolean` and `personal_data_volume?: PersonalDataVolume | null`; `scoreItemPoints` returns +2 for `internet_facing: true` and +3/+1/+0 for high/medium/low volume.
2. `Assessment` type (both `server/src/types.ts` and `client/src/types.ts`) includes `internet_facing: boolean` and `personal_data_volume: PersonalDataVolume | null`.
3. `assessments` DB table has `internet_facing` and `personal_data_volume` columns (added via `ensureColumn`; existing rows default to `0` / `NULL`).
4. `POST /assessments` and `PATCH /assessments/:id` accept and persist `internet_facing` and `personal_data_volume`.
5. `POST /assessments/:id/analyze` auto-detects both signals from questionnaire text and writes them to the assessment; analyst-declared values take precedence.
6. CloudPay demo scenario loads with `internet_facing: true` and `personal_data_volume: 'high'`; its expected_risk=Critical is met after analysis.
7. `NewAssessment.tsx` shows a checkbox and select for the two fields; values are passed in the create payload.
8. `ReviewWorkspace.tsx` shows "Internet-facing" and "Personal data volume" cells in the summary grid; analysts can toggle/edit them inline.
9. `npm run test` passes with all new and existing tests.
10. `npm run typecheck`, `npm run check`, and `npm run build` pass with zero errors.

### UX Scenarios, Acceptance & Evidence Checklist

**Scope:** `NewAssessment.tsx` (new form fields) + `ReviewWorkspace.tsx` summary grid (two new cells).

**Routes/flows:**
- `/assessments/new` — creation form with new "Exposure context" section
- `/assessments/:id` — review workspace summary grid with internet-facing + volume cells

**Viewports:** mobile (375px), tablet (768px), desktop (1280px)

**UX acceptance criteria:**
- At 375px, the "Exposure context" section wraps without horizontal overflow; checkbox and select labels are legible.
- At 375px, the summary grid gracefully reflows to a single-column stack (6 cells); no truncation or overflow.
- At 1280px, the grid expands to 3–4 columns; the two new cells fit without crowding existing cells.
- Internet-facing checkbox has a visible focus ring; keyboard-navigable.
- Personal data volume select has a visible focus ring; includes a "— unknown —" default option.
- axe: no new serious/critical a11y violations on either page.
- After PATCH (toggle internet_facing), the cell updates optimistically without a full reload.
- "Takes effect on next analysis run" hint text is visible but not prominently styled (secondary text).

**Before/after screenshots `/ux_validate` must capture:**
1. `NewAssessment` form at 375px showing the new "Exposure context" section.
2. `NewAssessment` form at 1280px (full form, new fields visible).
3. `ReviewWorkspace` summary grid at 375px (mobile stack, 6 cells).
4. `ReviewWorkspace` summary grid at 1280px (desktop, all 6 cells in grid).
5. `ReviewWorkspace` with internet_facing=true showing "Yes" chip and inline toggle.

**UX regression tasks:**
- Add `/assessments/new` and `/assessments/:id` (post-analysis state) entries to `e2e/ux/scenarios.ts` if not already present.
- Run `npm run test:ux` to confirm no new UX regressions.

### Validation Commands

```bash
# Biome lint + format check (run from repo root)
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# All unit tests (existing + new scoring factor cases)
npm run test

# Client production build
npm run build
```

Read `.claude/commands/test_e2e.md`, then read and execute `.claude/commands/e2e/test_risk_scoring_factors.md` to validate the feature works end-to-end.

## Known Limitations / Follow-ups

- **Score not retroactively updated.** Existing findings retain their old `risk_level` after PATCH of `internet_facing` / `personal_data_volume`. Re-analysis is required. A future enhancement could recompute and store `risk_level` on-the-fly when these assessment-level fields change.
- **Detection is keyword-only.** The rule-engine detector uses regex patterns on raw text. A Claude-backed classification (e.g., "does this description imply internet exposure?") would be more accurate but is outside the scope of this issue.
- **Volume is self-reported or inferred.** The detection heuristics look for explicit quantity keywords. Vendors that simply say "we process personal data" without quantifying it will be left as `null` (unknown). A follow-up could add a dedicated questionnaire field asking for record counts.
- **`personal_data_volume: null` in UI.** The select defaults to "— unknown —" which stores `null`. The score correctly treats `null` as 0 pts, but the ReviewWorkspace cell shows "Unknown" — future work could prompt analysts to fill in this value if the vendor processes personal data.
