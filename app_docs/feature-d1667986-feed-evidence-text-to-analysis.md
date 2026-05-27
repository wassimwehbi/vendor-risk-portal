# Feed Evidence Text into Analysis Pipeline

**ADW ID:** d1667986
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/issue-43-adw-d1667986-feed-evidence-text-to-analysis-plan.md

## Overview

The analysis pipeline now reads the extracted text of uploaded evidence documents (SOC 2 reports, ISO certificates, policy PDFs) when evaluating each questionnaire item. Previously, `evidence_sufficiency` verdicts were based solely on vendor-supplied spreadsheet metadata; now both the rule engine and the Claude provider ground their verdicts in actual document content, enabling evidence-sufficiency detection that distinguishes a real SOC 2 Type II opinion from a generic policy one-pager.

## What Was Built

- New `EvidenceContext` interface and updated `AnalysisProvider.analyzeItem` signature in `server/src/types.ts`
- Evidence fetching in `aiEngine.ts`: pre-analysis DB query retrieves all extracted evidence texts for the assessment
- Rule engine (`ruleEngine.ts`) updated to detect concrete signals in document text and upgrade `evidence_sufficiency` to `'Sufficient'` when corroborated; data-category detection now also scans document text
- Claude provider (`claudeProvider.ts`) updated to append evidence document excerpts to the per-item user message and instruct the model to ground its verdict in document content
- Unit test suite (`server/test/ruleEngineEvidence.test.ts`) covering five evidence-path scenarios

## Technical Implementation

### Files Modified

- `server/src/types.ts`: Added `EvidenceContext` interface; updated `AnalysisProvider.analyzeItem` signature to accept optional `evidence?: EvidenceContext[]`
- `server/src/services/aiEngine.ts`: Added pre-analysis DB query fetching `evidence_files` rows with `parse_status = 'extracted'`; passes resulting `EvidenceContext[]` to every `analyzeItem` call (primary provider and rule-engine fallback)
- `server/src/services/ruleEngine.ts`: Extended `assessEvidence` with document-level concrete-signal detection (`DOC_CONCRETE_SIGNALS` list); extended `detectDataCategories` and `analyzeItem` to include document text in `combined`; exported `assessEvidence` and `detectDataCategories` for unit testing
- `server/src/services/claudeProvider.ts`: Added `buildEvidenceBlock()` helper (max 5 files × 2 000 chars each); appended evidence block to per-item `userContent`; updated system prompt instruction for evidence-grounded verdict
- `server/test/ruleEngineEvidence.test.ts`: New unit tests (five scenarios)

### Key Changes

- **`EvidenceContext` type** (`{ name, kind, text }`) is the shared contract between the DB fetch and both engine implementations; the parameter is optional so existing direct callers are unaffected.
- **Rule engine concrete-signal list** (`DOC_CONCRETE_SIGNALS`): `'soc 2 type ii'`, `'iso 27001'`, `'certificate number'`, `'aes-256'`, `'tls 1.'`, `'penetration test'`, `'audit report'` — a document match + existing evidence metadata → `'Sufficient'`.
- **Generic-policy guard**: a document containing only policy/policies language without concrete artifact terms stays `'Insufficient'`, preventing marketing PDFs from inflating scores.
- **Expiration precedence**: `'Expired'` is returned before any document-text evaluation, preserving deterministic scoring.
- **Claude evidence block** is bounded (5 files, 2 000 chars each, `[truncated]` suffix) to keep per-call token budget manageable (~1 500 extra tokens).

## How to Use

This feature is transparent to analysts — no configuration or workflow change is required.

1. Upload a questionnaire CSV as usual.
2. Upload evidence files (SOC 2 PDF, ISO certificate, etc.) via the Evidence tab.
3. Run the analysis. The engine automatically fetches all evidence files with extracted text for the assessment before the analysis loop.
4. Review `evidence_sufficiency` verdicts in the Findings panel. Items corroborated by a document containing a concrete signal (e.g., `soc 2 type ii`, `certificate number`) will show `Sufficient`.

Evidence files that could not be parsed (`parse_status != 'extracted'`) or have no text (images, `.doc` files) are excluded from the context automatically.

## Configuration

No configuration required. The feature activates automatically when evidence files have been parsed (`parse_status = 'extracted'` and `extracted_text IS NOT NULL`). The `ANTHROPIC_API_KEY` environment variable continues to control whether the Claude provider or the rule engine is used as the primary provider.

## Testing

```bash
# TypeScript type checks
npm run typecheck

# All unit tests (includes new ruleEngineEvidence.test.ts)
npm run test

# Client production build
npm run build
```

The new test file `server/test/ruleEngineEvidence.test.ts` covers:
- SOC 2 Type II signal in document text → verdict upgrades to `'Sufficient'`
- Generic policy text only → verdict stays `'Insufficient'`
- No evidence context → falls back to existing behavior (`'None'` when no metadata)
- PHI terms in document text → detected in `data_categories` even when absent from item fields
- Expired evidence → `'Expired'` regardless of document content

## Notes

- **AI output is preliminary.** The final vendor-risk decision is always made by a human analyst, never automatically by the AI.
- **Assessment-level evidence association:** all evidence files are passed to every item call because the current schema links evidence at the assessment level, not per-item. A future issue could add a junction table (`evidence_item_links`) for per-item relevance.
- **Image and legacy `.doc` evidence** is excluded (`parse_status = 'no_text'` or `'unsupported'`); OCR support is a future concern.
- **Large evidence sets:** only the first 5 files (by upload order) are included in the Claude call. Relevance-based selection (e.g., embedding similarity) is a follow-up.
