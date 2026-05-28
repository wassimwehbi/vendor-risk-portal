# Fix: Derive applicable_frameworks from Per-Finding Mappings

**ADW ID:** da3f36cb
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/issue-48-adw-da3f36cb-derive-applicable-frameworks-plan.md

## Overview

Assessment-level `applicable_frameworks` was hardcoded to always include ISO 27001 and ISO 27002 with conditional GDPR/HIPAA, silently omitting NIST CSF and NIST 800-53 even though per-finding `framework_mappings` already referenced them. The fix refactors `deriveFrameworks` to union all frameworks found in per-finding mappings, keeping GDPR/HIPAA data-category gates as a belt-and-suspenders fallback.

## What Was Built

- Refactored `deriveFrameworks()` in `server/src/services/aiEngine.ts` to accept the full analyses array and collect frameworks from per-finding `framework_mappings`
- Preserved GDPR/HIPAA data-category safety-net logic to ensure regulatory frameworks are always promoted when relevant data categories are detected
- Removed the duplicated (buggy) `deriveFrameworks` copy in `server/test/scenarios.test.ts` and replaced it with the same union logic inline
- Extended the existing `SecureHealth` test to assert NIST CSF and NIST 800-53 are present
- Added a new `CloudPay` test asserting NIST frameworks appear even for non-PHI/non-personal-data scenarios

## Technical Implementation

### Files Modified

- `server/src/services/aiEngine.ts`: Changed `deriveFrameworks` signature to accept `analyses: Array<{ analysis: ItemAnalysis }>` as the first argument; replaced static array with a `Set` built from per-finding `framework_mappings`; updated call site to pass `analyses`
- `server/test/scenarios.test.ts`: Removed duplicate `deriveFrameworks` function; replaced it with inline union logic in `analyzeScenario`; added NIST assertions to the SecureHealth test and a new CloudPay NIST test

### Key Changes

- **Root cause fix:** `deriveFrameworks` now reads from `analysis.framework_mappings` (the authoritative per-finding data) instead of deriving frameworks solely from `DataCategory` values, which had no mapping to NIST frameworks
- **Signature change:** `deriveFrameworks(categories)` → `deriveFrameworks(analyses, categories)` — call site updated accordingly at `aiEngine.ts` line ~101
- **No schema or API changes:** `applicable_frameworks: string[]` shape is unchanged; only its contents are now correct
- **Test alignment:** Test helper now mirrors the fixed production logic exactly, eliminating the class of bugs where a duplicated function drifts from the original

## How to Use

No user-facing workflow changes are required. `GET /assessments/:id` now returns a complete `applicable_frameworks` array that includes NIST CSF and NIST 800-53 alongside ISO 27001, ISO 27002, and any applicable regulatory frameworks (GDPR, HIPAA).

1. Run an analysis on any assessment via the portal or API
2. Fetch `GET /assessments/:id` — `applicable_frameworks` will now include NIST CSF and NIST 800-53 in addition to ISO 27001 / ISO 27002
3. For PHI-containing assessments, HIPAA and GDPR continue to appear as before

## Configuration

No configuration changes required. The fix is purely a server-side computation change driven by the existing `server/src/data/frameworks.json` mappings, which already contained NIST references for all control domains.

## Testing

```bash
npm run check          # Biome lint + format (repo root)
npm run typecheck      # TypeScript strict-mode — server + client
npm run test           # All unit/scenario tests, including the two new/updated NIST assertions
npm run build          # Production client build
```

Key test cases:
- `SecureHealth triggers GDPR and HIPAA frameworks` — extended to also assert `NIST CSF` and `NIST 800-53`
- `CloudPay includes NIST CSF and NIST 800-53 in applicable frameworks` — new test confirming NIST is present for a non-PHI, non-personal-data scenario

## Notes

- **Framework order** in the output is now determined by iteration order over `analysis.framework_mappings` (the order they appear in `frameworks.json`). A deterministic display sort can be added in a follow-up if needed.
- **`financial` data category** does not currently trigger PCI-DSS; this is pre-existing and out of scope.
- If `frameworks.json` is ever restructured to omit NIST from certain domains, the union approach will correctly exclude NIST from assessments where none of the findings touch those domains.
- AI output is preliminary; the final vendor-risk decision is always made by a human analyst.
