# Spec — Fix hardcoded assessment-level applicable_frameworks (drops GDPR/NIST/HIPAA)

- **Status:** Implemented
- **Branch:** bug-issue-48-adw-da3f36cb-derive-applicable-frameworks
- **Location:** `server/src/services/aiEngine.ts`, `server/test/scenarios.test.ts`
- **Related docs:** `specs/adw/patch-adw-eaf33e16-expand-hipaa-framework-mappings-plan.md`, `README.md`, `API_CONTRACT.md`

## Problem / Objective

### Problem Statement
The assessment-level `applicable_frameworks` field is derived by `deriveFrameworks()` in `server/src/services/aiEngine.ts` (lines 29–34). This function hardcodes ISO 27001 and ISO 27002 as always-present and conditionally appends GDPR (if personal-data categories are detected) and HIPAA (if `phi` is detected). NIST CSF and NIST 800-53 are never appended regardless of the findings, so every generated report silently omits them even though per-finding `framework_mappings` already contain NIST references for all control domains.

### Symptoms
- `GET /assessments/:id` returns `applicable_frameworks: ["ISO 27001","ISO 27002"]` for most assessments.
- For PHI-heavy assessments the value is `["ISO 27001","ISO 27002","GDPR","HIPAA"]`, still missing both NIST frameworks.
- The per-finding `framework_mappings` array (stored in the `findings` table) already carries correct NIST CSF and NIST 800-53 references for every domain, creating an inconsistency between the finding-level and assessment-level data.

### Steps to Reproduce
1. Run a full analysis on any assessment (including SecureHealth scenario).
2. Fetch `GET /assessments/:id`.
3. Observe `applicable_frameworks` — NIST CSF and NIST 800-53 are absent.

### Root Cause Analysis
`deriveFrameworks()` (aiEngine.ts:29–34) computes applicability solely from detected `DataCategory` values. There is no data category that maps to NIST CSF or NIST 800-53, so these frameworks are unconditionally dropped. The correct source of truth for which frameworks are actually referenced is the per-finding `framework_mappings`, which are already populated from `server/src/data/frameworks.json` (all six frameworks are present in every control domain). The assessment-level summary should reflect the union of frameworks that appear in findings, supplemented by explicit data-category gates for GDPR and HIPAA.

The same `deriveFrameworks` logic is duplicated verbatim in `server/test/scenarios.test.ts` (lines 17–22), so the test also mirrors the bug.

## Approach & Changes

Refactor `deriveFrameworks` to accept the full analyses array (so it can scan `framework_mappings`) and keep the data-category gates for GDPR and HIPAA as a belt-and-suspenders fallback. This is purely a server-side computation change — no database schema, API shape, or client code changes are required.

**Relevant files:**

- `server/src/services/aiEngine.ts` — contains `deriveFrameworks` (the bug) and its call site at line 99. The function's signature changes to accept analyses; the GDPR/HIPAA data-category logic is preserved as a safety net.
- `server/test/scenarios.test.ts` — contains a duplicated copy of `deriveFrameworks` (lines 8–22) that must be updated to match, and the `analyzeScenario` helper that must pass analyses to it. The existing `SecureHealth` framework test must be extended to also assert NIST CSF and NIST 800-53 are present.

### Step by Step Tasks

#### 1. Update `deriveFrameworks` in `server/src/services/aiEngine.ts`

- Change the function signature to accept an analyses array alongside data categories:
  ```typescript
  function deriveFrameworks(
    analyses: Array<{ analysis: ItemAnalysis }>,
    categories: DataCategory[],
  ): string[] {
    const set = new Set<string>();
    // Collect every framework referenced in per-finding mappings.
    for (const { analysis } of analyses) {
      for (const { framework } of analysis.framework_mappings) {
        set.add(framework);
      }
    }
    // Data-category safety nets: ensure GDPR/HIPAA are present when
    // relevant categories are detected, even if a mapping is missing.
    if (categories.some((c) => GDPR_TRIGGERS.includes(c))) set.add('GDPR');
    if (categories.includes('phi')) set.add('HIPAA');
    return [...set];
  }
  ```
- Update the call site (line 99) to pass `analyses` as the first argument:
  ```typescript
  const applicable_frameworks = deriveFrameworks(analyses, data_categories);
  ```
- Remove the now-unused import of `ItemAnalysis` if it was not already imported — actually `ItemAnalysis` is already imported at the top of `aiEngine.ts` via the destructured types import.

#### 2. Update `server/test/scenarios.test.ts`

- Remove the duplicated `GDPR_TRIGGERS` constant and `deriveFrameworks` function (lines 8–22).
- Update `analyzeScenario` to derive frameworks from per-finding mappings + data-category safety nets inline (or extract a shared helper), so the helper mirrors the fixed `aiEngine` logic:
  ```typescript
  // Collect frameworks from per-finding mappings + data-category safety nets.
  const frameworkSet = new Set<string>();
  analyses.forEach(({ analysis }) => {
    analysis.framework_mappings.forEach(({ framework }) => frameworkSet.add(framework));
  });
  const GDPR_TRIGGERS: DataCategory[] = ['personal','sensitive_personal','children','employee','cross_border','subprocessors'];
  if (data_categories.some((c) => GDPR_TRIGGERS.includes(c))) frameworkSet.add('GDPR');
  if (data_categories.includes('phi')) frameworkSet.add('HIPAA');
  const frameworks = [...frameworkSet];
  ```
- Extend the `SecureHealth triggers GDPR and HIPAA frameworks` test to also assert NIST CSF and NIST 800-53:
  ```typescript
  assert.ok(frameworks.includes('NIST CSF'), 'expected NIST CSF');
  assert.ok(frameworks.includes('NIST 800-53'), 'expected NIST 800-53');
  ```
- Add a new test asserting that NIST frameworks are present even for a non-PHI/non-personal scenario (e.g., `cloudpay`):
  ```typescript
  test('CloudPay includes NIST CSF and NIST 800-53 in applicable frameworks', async () => {
    const { frameworks } = await analyzeScenario('cloudpay');
    assert.ok(frameworks.includes('NIST CSF'), 'expected NIST CSF');
    assert.ok(frameworks.includes('NIST 800-53'), 'expected NIST 800-53');
  });
  ```

#### 3. Run Verification Commands

- `npm run check` — Biome lint + format (run from repo root)
- `npm run typecheck` — TypeScript strict-mode check for server + client
- `npm run test` — all unit/scenario tests pass
- `npm run build` — production client build succeeds

## Key Decisions & Rationale

**Why union from per-finding mappings?** The per-finding `framework_mappings` are already populated from `frameworks.json`, which is the authoritative source for control-domain → framework cross-references. Reading the union of those frameworks at the assessment level ensures `applicable_frameworks` accurately reflects what the analysis actually consulted — not a parallel, potentially divergent derivation.

**Why keep the GDPR/HIPAA data-category gates?** These serve as a safety net: if a domain mapping entry is ever missing GDPR or HIPAA for a particular control (e.g., future partial edits to `frameworks.json`), the data-category detection still promotes the correct regulatory context to the report. Belt-and-suspenders, not duplication.

**Why always include NIST CSF and NIST 800-53?** NIST is a baseline security framework (not tied to a specific data-sensitivity class), and `frameworks.json` includes NIST references in every control domain. The union approach naturally produces this result without hardcoding.

**Minimal footprint:** No database migrations, no API contract changes, no client changes. The shape of `applicable_frameworks: string[]` stays the same; only its contents change.

## Verification

### Reproduce the bug (before fix)
```bash
# Start dev server, run analysis on SecureHealth scenario, observe applicable_frameworks.
npm --prefix server test -- --grep "SecureHealth"
# Observe: NIST CSF and NIST 800-53 are absent from framework assertions.
```

### Confirm fix (after applying changes)
```bash
npm run check
npm run typecheck
npm run test
npm run build
```

- `npm run check` — Biome lint + format check (run from repo/worktree root)
- `npm run typecheck` — Server + client TypeScript type checks
- `npm run test` — Server + client unit tests, including updated/new scenario assertions
- `npm run build` — Client production build

**Expected test outcomes after fix:**
- `SecureHealth triggers GDPR and HIPAA frameworks` passes with four additional NIST assertions.
- New `CloudPay includes NIST CSF and NIST 800-53` test passes.
- All existing scenario risk-band tests continue to pass unchanged.

## Known Limitations / Follow-ups

- **Order of frameworks in the output** is now determined by iteration order over `analysis.framework_mappings` (the order they appear in `frameworks.json`). If a deterministic display order is desired in the UI, sorting can be added in a follow-up — but it is not required by the acceptance criteria and is out of scope here.
- **`financial` data category** does not currently trigger any additional frameworks (e.g., PCI-DSS). This is pre-existing and outside the scope of this fix.
- If `frameworks.json` is ever restructured to omit NIST from certain domains, the union approach will correctly exclude NIST from assessments where none of the findings touch those domains. This is the desired behavior.
