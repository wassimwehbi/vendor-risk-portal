# Spec — Complete Evidence-Sufficiency Detection

- **Status:** Draft
- **Branch:** feat-issue-46-adw-29502dfe-complete-evidence-sufficiency-detection
- **Location:** `server/src/services/ruleEngine.ts`, `server/test/ruleEngineEvidence.test.ts`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md`, `specs/adw/issue-43-adw-d1667986-feed-evidence-text-to-analysis-plan.md`, `API_CONTRACT.md`

## Problem / Objective

**User Story:** As a security analyst, I want the rule engine to detect when vendor evidence is misaligned with the answer, when a SOC 2 report's review period doesn't cover the assessment date, and when a screenshot lacks a date or scope — so that false-sufficient verdicts don't pass through undetected.

**Problem Statement:** The deterministic rule engine (`server/src/services/ruleEngine.ts`) currently detects only 3 of 6 evidence-sufficiency gap patterns specified in Req 4C:

| Gap | Detected? | Where |
|-----|-----------|-------|
| No evidence | ✅ → `None` | `assessEvidence` |
| Expired certification | ✅ → `Expired` | `isExpired` / `assessEvidence` |
| Generic policy without proof | ✅ → `Insufficient` | `assessEvidence` |
| Evidence not aligned with answer | ❌ | `Misaligned` enum exists in `types.ts` and display text exists in `buildFinding`/`buildFollowUps`, but the rule engine never assigns it |
| SOC 2 outside its valid review period | ❌ | `isExpired` compares `expiration_date` to `Date.now()`; `relevant_date` (the assessment's as-of date) is never read |
| Screenshot without date/scope | ❌ | `'screenshot'` is treated only as a positive token (inside the generic-policy exclusion pattern at line ~246); undated/unscoped images are never flagged |

All three fixes are confined to `ruleEngine.ts` and its unit tests; no schema change, API change, or UI change is required — `Misaligned` is already in the `EvidenceSufficiency` union type, and all display text already handles it.

## Approach & Changes

Extend `assessEvidence` with three targeted heuristics while preserving the existing priority order (expiry wins; concrete signals win; generic policy loses):

1. **`relevant_date`-aware expiry check** — update `isExpired` to accept an optional reference date. When `item.relevant_date` is set, compare `expiration_date` against it instead of `Date.now()`. This catches SOC 2 reports that were already expired at the time the questionnaire was filled out, regardless of today's date.

2. **Domain-alignment check** — import `CONTROL_DOMAINS` from `controlDomains.ts`. After a document has text but no concrete signals, check whether the document text contains any keyword from the classified control domain. If the evidence has substantial text (>200 chars) but zero domain keywords, emit `Misaligned`. This catches a vendor uploading an HR onboarding document in response to an MFA question.

3. **Screenshot context check** — if any evidence item has `kind === 'image'`, inspect its filename for a date pattern (`\d{4}[-_]\d{2}` or `Q[1-4]`) and a scope indicator (filename longer than a generic prefix). If every image evidence item lacks both, return `Insufficient`. This catches screenshots with names like `screenshot.png` or `img001.jpg` that provide no auditability.

**Relevant files:**
- `server/src/services/ruleEngine.ts` — all logic changes; one new import (`CONTROL_DOMAINS`); updated `isExpired`, `assessEvidence` signature + body; new helpers `screenshotLacksContext` and `isEvidenceMisaligned`
- `server/test/ruleEngineEvidence.test.ts` — extend with new test cases for all three new checks; no new file needed

### New Files

None — changes are additive to existing files only.

### Implementation Plan

**Phase 1 — Foundation: `relevant_date`-aware expiry**
Update `isExpired` to a two-argument form `isExpiredAtDate(expirationDateStr, referenceDateStr?)` that uses `referenceDateStr` when provided and falls back to `Date.now()`. Update the single `isExpired` call-site in `assessEvidence` to pass `item.relevant_date`.

**Phase 2 — Core: misalignment and screenshot helpers**
Add `isEvidenceMisaligned(domain, evidence)` and `screenshotLacksContext(evidence)`. Wire both into `assessEvidence` in the correct priority slot (after expiry and concrete-signal checks; before generic-policy and item-level checks). Update the `assessEvidence` signature to include `domain: string`. Update the single call-site in `analyzeItem` to pass `control_domain`.

**Phase 3 — Tests**
Extend `server/test/ruleEngineEvidence.test.ts` with focused test cases for each new branch. Confirm all existing tests still pass.

### Step by Step Tasks

#### Step 1 — Read key files before editing

- Read `server/src/services/ruleEngine.ts` in full to confirm current line layout.
- Read `server/src/data/controlDomains.ts` lines 1–30 to confirm the `ControlDomain.keywords` shape.
- Read `server/test/ruleEngineEvidence.test.ts` in full to understand existing test style.

#### Step 2 — Update `ruleEngine.ts`: `relevant_date`-aware expiry

- Add `CONTROL_DOMAINS` to the import from `'../data/controlDomains'`:
  ```typescript
  import { classifyByKeywords, CONTROL_DOMAINS } from '../data/controlDomains';
  ```
- Replace `isExpired(dateStr: string | null): boolean` with a two-argument version:
  ```typescript
  function isExpiredAtDate(expirationDateStr: string | null, referenceDateStr?: string | null): boolean {
    if (!expirationDateStr) return false;
    const expiry = new Date(expirationDateStr);
    if (isNaN(expiry.getTime())) return false;
    const ref = referenceDateStr ? new Date(referenceDateStr) : new Date();
    if (isNaN(ref.getTime())) return expiry.getTime() < Date.now();
    return expiry.getTime() < ref.getTime();
  }
  ```
- Update the expiry call in `assessEvidence`:
  ```typescript
  if (isExpiredAtDate(item.expiration_date, item.relevant_date)) return 'Expired';
  ```

#### Step 3 — Update `ruleEngine.ts`: misalignment helper

- Add `isEvidenceMisaligned` after the expiry helper:
  ```typescript
  function isEvidenceMisaligned(domain: string, evidence: EvidenceContext[]): boolean {
    const textualEvidence = evidence?.filter((e) => e.kind !== 'image' && e.text.trim().length > 200) ?? [];
    if (textualEvidence.length === 0) return false;
    const domainEntry = CONTROL_DOMAINS.find((d) => d.name === domain);
    if (!domainEntry || domainEntry.keywords.length === 0) return false;
    const combinedDocText = textualEvidence.map((e) => e.text).join('\n').toLowerCase();
    return !domainEntry.keywords.some((kw) => combinedDocText.includes(kw.toLowerCase()));
  }
  ```
  - Only considers non-image evidence with > 200 chars (avoids false positives on cover-page stubs or empty images).
  - Falls through silently for "Uncategorized" domain (no keywords → can't determine misalignment).

#### Step 4 — Update `ruleEngine.ts`: screenshot context helper

- Add `screenshotLacksContext` after `isEvidenceMisaligned`:
  ```typescript
  const DATE_PATTERN = /\d{4}[-_]\d{2}|q[1-4][-_ ]\d{4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
  const GENERIC_SCREENSHOT_PREFIX = /^(screenshot|screen[-_ ]?shot|img|image|capture|snap)[\s_-]?\d*/i;

  function screenshotLacksContext(evidence: EvidenceContext[]): boolean {
    const images = evidence?.filter((e) => e.kind === 'image') ?? [];
    if (images.length === 0) return false;
    return images.every((img) => {
      const name = img.name;
      const hasDate = DATE_PATTERN.test(name);
      const hasScope = !GENERIC_SCREENSHOT_PREFIX.test(name) && name.replace(/\.[^.]+$/, '').length > 12;
      return !hasDate && !hasScope;
    });
  }
  ```
  - Flags only when ALL image items lack both a date AND a meaningful scope name.
  - A filename like `mfa-config-2024-03.png` passes (has date); `aws-console-iam-dashboard.png` passes (meaningful scope name > 12 chars, not generic prefix); `screenshot.png` fails.

#### Step 5 — Update `assessEvidence` signature and body

- Add `domain: string` as a new parameter (after `strength`, before `evidence?`):
  ```typescript
  export function assessEvidence(
    item: QuestionnaireItem,
    text: string,
    strength: ControlStrength,
    domain: string,
    evidence?: EvidenceContext[],
  ): EvidenceSufficiency {
  ```
- Inside the function, insert the two new checks in the correct priority slots:

  **After the existing `docHasConcrete && hasEvidence` → `Sufficient` line**, add:
  ```typescript
  // Evidence text exists but has no keywords from the classified domain → Misaligned.
  if (evidence && isEvidenceMisaligned(domain, evidence)) return 'Misaligned';

  // Screenshot evidence with no date or scope in filename → not auditable.
  if (evidence && screenshotLacksContext(evidence)) return 'Insufficient';
  ```
  
  Full priority order in `assessEvidence` after the change:
  1. `isExpiredAtDate` → `Expired`
  2. `docHasConcrete && hasEvidence` → `Sufficient`
  3. `isEvidenceMisaligned` → `Misaligned` ← new
  4. `screenshotLacksContext` → `Insufficient` ← new
  5. `docGenericOnly` → `Insufficient`
  6. `!hasEvidence` → `None`
  7. Item-level `genericOnly` / vague / weak → `Insufficient`
  8. Otherwise → `Sufficient`

#### Step 6 — Update `analyzeItem` call-site

- In `analyzeItem`, pass `control_domain` to `assessEvidence`:
  ```typescript
  const evidence_sufficiency = assessEvidence(item, combined, control_strength, control_domain, evidence);
  ```
  This is the only call-site; no other code calls `assessEvidence` directly except the unit tests.

#### Step 7 — Update unit tests in `ruleEngineEvidence.test.ts`

Update all direct calls to `assessEvidence` in the test file — add `'Vulnerability Management'` (or the appropriate domain string) as the new fourth positional argument to every existing call that does NOT test misalignment. Then add the following new test cases:

**SOC 2 review window (`relevant_date`):**
```typescript
test('expiration before relevant_date flags Expired even when not expired today', () => {
  // expiration_date is in the future relative to today but before relevant_date
  const futureRelevantDate = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const expiresBeforeRelevant = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const item = makeItem({ relevant_date: futureRelevantDate, expiration_date: expiresBeforeRelevant });
  const result = assessEvidence(item, 'yes', 'Strong', 'MFA', SOC2_EVIDENCE);
  assert.equal(result, 'Expired');
});

test('cert valid at relevant_date is not flagged Expired', () => {
  const relevantDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10); // 1 year ago
  const expiresAfterRelevant = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10); // 6mo ago — expired now but was valid at relevant_date
  const item = makeItem({ relevant_date: relevantDate, expiration_date: expiresAfterRelevant });
  // cert expired AFTER relevant_date: should NOT be Expired under relevant_date check
  // but IS expired today — confirm which reference wins
  // With relevant_date as reference: expiry(6mo ago) > relevant(1yr ago) → not expired → falls through
  const result = assessEvidence(item, 'yes', 'Strong', 'Vulnerability Management', SOC2_EVIDENCE);
  // SOC2 concrete signal present + hasEvidence → Sufficient (expiry check passed)
  assert.equal(result, 'Sufficient');
});
```

**Evidence misalignment:**
```typescript
const HR_POLICY_EVIDENCE: EvidenceContext[] = [
  {
    name: 'HR-Onboarding-Policy.pdf',
    kind: 'pdf',
    text: 'This document describes employee onboarding procedures, benefits enrollment, leave policies, and code of conduct requirements. All new hires must complete orientation within 30 days of joining.',
  },
];

test('evidence document with no domain keywords emits Misaligned', () => {
  const item = makeItem({
    question_text: 'Do you enforce multi-factor authentication for all users?',
    response: 'Yes',
    evidence_text: 'See attached policy',
  });
  const result = assessEvidence(item, 'yes', 'Strong', 'MFA', HR_POLICY_EVIDENCE);
  assert.equal(result, 'Misaligned');
});

test('evidence document containing domain keywords does not emit Misaligned', () => {
  const mfaEvidence: EvidenceContext[] = [
    {
      name: 'MFA-Configuration.pdf',
      kind: 'pdf',
      text: 'Multi-factor authentication (MFA) is enforced for all user accounts. OTP via authenticator app is required. Two-factor authentication cannot be bypassed.',
    },
  ];
  const item = makeItem({
    question_text: 'Do you enforce multi-factor authentication?',
    response: 'Yes',
    evidence_text: 'See attached config',
  });
  const result = assessEvidence(item, 'yes', 'Strong', 'MFA', mfaEvidence);
  assert.notEqual(result, 'Misaligned');
});

test('Uncategorized domain skips misalignment check', () => {
  const item = makeItem({ evidence_text: 'attached', evidence_location: null });
  // HR policy evidence + domain that has no keywords → should not emit Misaligned
  const result = assessEvidence(item, 'yes', 'Strong', 'Uncategorized', HR_POLICY_EVIDENCE);
  assert.notEqual(result, 'Misaligned');
});
```

**Screenshot without date/scope:**
```typescript
test('undated unscoped screenshot returns Insufficient', () => {
  const screenshotEvidence: EvidenceContext[] = [
    { name: 'screenshot.png', kind: 'image', text: '' },
  ];
  const item = makeItem({ evidence_text: 'see screenshot', evidence_location: null });
  const result = assessEvidence(item, 'yes', 'Strong', 'MFA', screenshotEvidence);
  assert.equal(result, 'Insufficient');
});

test('screenshot with date in filename passes context check', () => {
  const screenshotEvidence: EvidenceContext[] = [
    { name: 'mfa-dashboard-2024-03.png', kind: 'image', text: '' },
  ];
  const item = makeItem({ evidence_text: 'see screenshot', evidence_location: null });
  const result = assessEvidence(item, 'yes mfa enforced', 'Strong', 'MFA', screenshotEvidence);
  assert.notEqual(result, 'Insufficient');
});

test('screenshot with meaningful scope name passes context check', () => {
  const screenshotEvidence: EvidenceContext[] = [
    { name: 'aws-iam-console-mfa-enforcement.png', kind: 'image', text: '' },
  ];
  const item = makeItem({ evidence_text: 'IAM console screenshot', evidence_location: null });
  const result = assessEvidence(item, 'yes mfa enforced', 'Strong', 'MFA', screenshotEvidence);
  assert.notEqual(result, 'Insufficient');
});

test('mixed evidence: undated screenshot + SOC2 pdf → concrete signal wins as Sufficient', () => {
  const mixedEvidence: EvidenceContext[] = [
    { name: 'screenshot.png', kind: 'image', text: '' },
    ...SOC2_EVIDENCE,
  ];
  const item = makeItem({ evidence_text: 'see attached' });
  const result = assessEvidence(item, 'yes', 'Strong', 'Vulnerability Management', mixedEvidence);
  // SOC2 has concrete signal → Sufficient takes priority over screenshot check
  assert.equal(result, 'Sufficient');
});
```

#### Step 8 — Run validation commands (see Validation section)

## Key Decisions & Rationale

**Use `relevant_date` as the reference for expiry when present, not as an additional check.** Using `relevant_date` replaces `Date.now()` for the expiry comparison rather than adding a second check. This preserves historical accuracy: a questionnaire filed in 2023 should be evaluated against 2023's validity window, not today's. Certs that expire after `relevant_date` but before today were valid when the questionnaire was filed — flagging them as expired would be misleading for historical records.

**Misalignment requires >200 chars of document text.** Short documents (title pages, one-liner stubs) do not reliably reveal the document's domain, so we skip misalignment detection below the threshold. This avoids false positives on scanned covers or redacted summaries.

**Misalignment is skipped for "Uncategorized" domain.** There are no keywords to match against, so the heuristic cannot determine whether the evidence is relevant or not. Emitting `Misaligned` without a basis would introduce noise.

**`screenshotLacksContext` requires ALL image evidence to fail the check.** If even one screenshot has a meaningful name (date or scope), the check passes. This avoids penalizing assessments with a mix of well-labelled and generic screenshots.

**Screenshot context wins over misalignment, misalignment wins over generic-policy.** The priority order places misalignment and screenshot checks after the concrete-signal (SOC 2 / ISO cert) shortcut. This means a concrete certificate always overrides misalignment — a document that has a cert number but also has no domain keyword is still treated as `Sufficient`. Only ambiguous documents (no concrete signal, no generic-only pattern) reach the alignment check.

**No new type, no schema migration, no API change.** `Misaligned` is already in `EvidenceSufficiency` and all display/follow-up text is already wired in `buildFinding` and `buildFollowUps`. The `assessEvidence` signature change (new `domain` parameter) has one call-site in `analyzeItem` and all test call-sites — both are updated in this plan.

**`assessEvidence` is already exported** (line 224) so test files can call it directly; no export change needed.

## Verification

### Unit Tests & Edge Cases

- **SOC 2 review window**: cert expired before `relevant_date` → `Expired`; cert valid at `relevant_date` but expired today → `Sufficient` (concrete signal present); no `relevant_date` + expired today → `Expired` (unchanged behavior).
- **Misalignment**: HR policy for MFA domain → `Misaligned`; MFA config for MFA domain → not `Misaligned`; any domain + "Uncategorized" → not `Misaligned`.
- **Screenshot**: `screenshot.png` alone → `Insufficient`; `mfa-2024-03.png` → not `Insufficient`; `aws-console-iam.png` → not `Insufficient`; `screenshot.png` + SOC2 PDF → `Sufficient` (concrete signal wins).
- **Regression**: all 10 existing tests in `ruleEngineEvidence.test.ts` must still pass after the `assessEvidence` signature update.

### Acceptance Criteria

1. Rule engine emits `Misaligned` when a textual evidence document (>200 chars) contains no keyword from the classified control domain.
2. Rule engine emits `Expired` when `expiration_date < relevant_date` (assessment as-of date), not just when `expiration_date < Date.now()`.
3. Rule engine emits `Insufficient` when all image evidence items have filenames that lack a date pattern and a meaningful scope name.
4. All 3 new checks are subordinate to the concrete-signal shortcut: a document with `soc 2 type ii` / `iso 27001` / etc. still returns `Sufficient`.
5. `npm run test` passes with zero failures (new cases + all prior `ruleEngineEvidence.test.ts` tests).
6. `npm run typecheck` passes — updated `assessEvidence` signature propagated to its one call-site.
7. `npm run check` passes — Biome lint/format clean.
8. `npm run build` succeeds.

### Validation Commands

```bash
# Biome lint + format check (run from repo root)
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# All unit tests (existing + new evidence-sufficiency cases)
npm run test

# Client production build
npm run build
```

## Known Limitations / Follow-ups

- **OCR for images**: screenshots have `parse_status = 'no_text'` — the alignment check can only inspect filenames. If OCR is added in a future spec, `isEvidenceMisaligned` would automatically benefit from image text without further changes to the priority logic.
- **Item-level evidence association**: evidence is attached at the assessment level, not per-item. The misalignment check passes all uploaded documents to every item. A future junction table (`evidence_item_links`) would let analysts tag which document supports which answer, enabling tighter alignment checks.
- **Misalignment threshold tuning**: the 200-char minimum and the "zero keyword overlap" threshold are conservative. A future enhancement could use a scoring approach (e.g., at least 1% keyword density) or a lightweight embedding similarity check.
- **Claude provider**: the Claude path already receives the same `EvidenceContext[]` via spec 0043. Claude can emit `Misaligned` via its own reasoning; this issue only concerns the deterministic rule-engine path.
