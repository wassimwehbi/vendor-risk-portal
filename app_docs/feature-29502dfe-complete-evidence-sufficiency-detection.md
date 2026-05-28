# Complete Evidence Sufficiency Detection

**ADW ID:** 29502dfe
**Date:** 2026-05-28
**Plan-Spec:** specs/adw/issue-46-adw-29502dfe-complete-evidence-sufficiency-detection-plan.md

## Overview

Extends the deterministic rule engine to detect three previously undetected evidence-sufficiency gap patterns: evidence documents misaligned with the assessed control domain, SOC 2 / certification reports that were expired at the time the questionnaire was filed (not just today), and screenshots with no date or scope in their filename. Prior to this change, only 3 of 6 Req 4C gap patterns were covered; all 6 are now handled without any schema, API, or UI change.

## What Was Built

- **`relevant_date`-aware expiry check** — `isExpiredAtDate(expirationDateStr, referenceDateStr?)` replaces the former `isExpired`. When `item.relevant_date` is set, the certification's `expiration_date` is compared against that historical reference date rather than `Date.now()`, preserving accuracy for archived questionnaires.
- **Domain-alignment check** — `isEvidenceMisaligned(domain, evidence)` scans all textual evidence items (>200 chars) for keywords from the classified control domain. If none are found, the function returns `Misaligned`, catching uploads like an HR onboarding policy attached to an MFA question.
- **Screenshot context check** — `screenshotLacksContext(evidence)` inspects image filenames for a date pattern (`YYYY-MM`, `Q1 2024`, month abbreviations) or a meaningful scope indicator (filename >12 chars, non-generic prefix). If every image evidence item fails both tests, it returns `Insufficient`.
- **Updated `assessEvidence` signature** — the `domain: string` parameter was added and propagated to the single production call-site in `analyzeItem`.
- **Expanded unit test suite** — 11 new focused test cases cover all three heuristics and their priority interactions; all 10 prior tests continue to pass.

## Technical Implementation

### Files Modified

- `server/src/services/ruleEngine.ts`: replaced `isExpired` with `isExpiredAtDate`, added `isEvidenceMisaligned` and `screenshotLacksContext` helpers, updated `assessEvidence` signature and body, added `CONTROL_DOMAINS` import, updated `analyzeItem` call-site.
- `server/test/ruleEngineEvidence.test.ts`: updated all existing `assessEvidence` calls to pass the new `domain` argument; added 11 new test cases across three feature areas.

### Key Changes

- `isExpiredAtDate` falls back to `Date.now()` when `referenceDateStr` is absent or invalid, preserving unchanged behavior for existing records without a `relevant_date`.
- `isEvidenceMisaligned` silently skips the check for the `"Uncategorized"` domain (no keywords defined) to avoid false positives on unclassified controls.
- `screenshotLacksContext` requires ALL image evidence to fail the date + scope tests — one well-named screenshot in a set allows the whole set to pass.
- Priority order in `assessEvidence`: expiry → concrete-signal (`Sufficient`) → misalignment → screenshot context → generic-only policy → no metadata → item-level vagueness. Concrete certificates (SOC 2, ISO 27001) always short-circuit to `Sufficient` before alignment checks run.
- `Misaligned` is already present in the `EvidenceSufficiency` union type and already handled in `buildFinding` / `buildFollowUps` — no display-layer changes were needed.

## How to Use

No user action is required; the checks run automatically as part of every questionnaire analysis.

1. Upload a vendor questionnaire through the portal as normal.
2. The rule engine evaluates each item's evidence. Findings now distinguish three additional gap types:
   - `Misaligned` — evidence documents exist but contain no terminology from the control domain. Follow-up prompts will ask the vendor to resubmit relevant documentation.
   - `Expired` — a certification was expired at the time the questionnaire was filed (using the `relevant_date` field if present). This prevents a cert that lapsed between filing and today from being incorrectly marked valid.
   - `Insufficient` (screenshot path) — all uploaded image evidence has a generic or undated filename that provides no auditability trail.
3. Review findings in the assessment grid; the `Evidence` column badge reflects the new verdicts.

> **Note:** AI output (Claude provider path) is preliminary. The final vendor-risk decision is always made by a human analyst.

## Configuration

No configuration changes. The three new checks are unconditionally enabled and use data already present in:
- `item.relevant_date` (existing schema column, optional)
- `item.expiration_date` (existing schema column, optional)
- `EvidenceContext[].kind` and `EvidenceContext[].name` (existing evidence shape)
- `CONTROL_DOMAINS` from `server/src/data/controlDomains.ts` (existing static data)

## Testing

```bash
# Biome lint + format check
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# All unit tests — includes all 10 prior ruleEngineEvidence tests + 11 new cases
npm run test

# Client production build
npm run build
```

Key test cases to verify:
- `expiration before relevant_date flags Expired even when not expired today`
- `cert valid at relevant_date is not flagged Expired`
- `evidence document with no domain keywords emits Misaligned`
- `Uncategorized domain skips misalignment check`
- `undated unscoped screenshot returns Insufficient`
- `mixed evidence: undated screenshot + SOC2 pdf → concrete signal wins as Sufficient`

## Notes

- **OCR for images**: screenshots currently have `parse_status = 'no_text'`; the alignment check only inspects filenames. Future OCR support would automatically benefit `isEvidenceMisaligned` without logic changes.
- **Item-level evidence association**: evidence is attached at the assessment level, not per-item. Every uploaded document is passed to every item's analysis. A future `evidence_item_links` junction table would enable tighter, per-answer alignment checks.
- **Threshold tuning**: the 200-char minimum and "zero keyword overlap" rule are intentionally conservative. A future enhancement could introduce keyword-density scoring or lightweight embedding similarity.
- The Claude provider path already receives the same `EvidenceContext[]` (spec 0043) and can emit `Misaligned` via its own reasoning independently of these deterministic checks.
