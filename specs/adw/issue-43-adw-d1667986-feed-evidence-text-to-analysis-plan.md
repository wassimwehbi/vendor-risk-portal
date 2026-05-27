# Spec — Feed Extracted Evidence Text into the Analysis Pipeline

- **Status:** Draft
- **Branch:** feat-issue-43-adw-d1667986-feed-evidence-text-to-analysis
- **Location:** `server/src/types.ts`, `server/src/services/aiEngine.ts`, `server/src/services/ruleEngine.ts`, `server/src/services/claudeProvider.ts`, `server/test/ruleEngineEvidence.test.ts`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md`, `API_CONTRACT.md`, `README.md`

## Problem / Objective

**User Story:** As a security analyst, I want the analysis engine to evaluate actual uploaded evidence documents (SOC 2 reports, ISO certificates, policy PDFs) — not just the vendor's spreadsheet text — so that evidence-sufficiency verdicts are grounded in real content rather than self-reported metadata.

**Problem Statement:** The evidence extraction pipeline already parses uploaded files and stores their text in `evidence_files.extracted_text`. However, neither the Claude provider nor the rule engine ever reads this column — `analyzeItem(item: QuestionnaireItem)` receives only the questionnaire item, whose `evidence_text` and `evidence_location` fields are vendor-supplied spreadsheet metadata (not document content). As a result, "evidence provided" verdicts are blind to whether the attached PDF actually contains a SOC 2 Type II opinion, an ISO 27001 certificate number, or just a generic marketing one-pager. This is the gap most visible to a security reviewer and directly blocks the evidence-sufficiency detection work (SOC 2 review window, misaligned evidence, screenshot scope).

## Approach & Changes

Extend the `AnalysisProvider.analyzeItem` interface to accept an optional `EvidenceContext[]` parameter. In `aiEngine.ts`, fetch all evidence files with extracted text for the assessment before the analysis loop and pass them into each `analyzeItem` call. Both engines use this context to produce better `evidence_sufficiency` verdicts and richer data-category detection.

**Relevant files:**
- `server/src/types.ts` — add `EvidenceContext` interface; update `AnalysisProvider.analyzeItem` signature (backward-compatible optional param)
- `server/src/services/aiEngine.ts` — fetch extracted evidence rows; pass `EvidenceContext[]` to each `analyzeItem` call
- `server/src/services/ruleEngine.ts` — update `assessEvidence` and `detectDataCategories` to use document text when present
- `server/src/services/claudeProvider.ts` — append evidence document excerpts to the per-item user message; update system prompt to instruct use of document content

### New Files

- `server/test/ruleEngineEvidence.test.ts` — unit tests verifying that evidence document text changes the `evidence_sufficiency` verdict

### Implementation Plan

**Phase 1 — Foundation (types + interface)**
Add the `EvidenceContext` type and update the `AnalysisProvider` interface so both engines share the same contract. The parameter is optional to preserve backward compatibility in any direct callers.

**Phase 2 — Core Implementation (engines)**
Update the rule engine to search both the questionnaire item and the evidence document text. Update the Claude provider to include a bounded evidence block in the per-item user message and instruct the model to ground its verdict in the document content.

**Phase 3 — Orchestration (aiEngine)**
Fetch the relevant evidence rows inside `analyzeAssessment` (before the analysis loop) and pass the resulting `EvidenceContext[]` to every `analyzeItem` call. Also extend data-category aggregation to include categories detected from document text in the rule engine path.

### Step by Step Tasks

#### Step 1 — Add `EvidenceContext` type and update `AnalysisProvider` interface

- In `server/src/types.ts`, add after the `EvidenceFile` interface:
  ```typescript
  export interface EvidenceContext {
    name: string;       // original filename — used by Claude for attribution
    kind: EvidenceKind;
    text: string;       // extracted text, pre-truncated by caller
  }
  ```
- Update `AnalysisProvider`:
  ```typescript
  export interface AnalysisProvider {
    name: AiEngine;
    analyzeItem(item: QuestionnaireItem, evidence?: EvidenceContext[]): Promise<ItemAnalysis>;
  }
  ```

#### Step 2 — Update `ruleEngine.ts` to use evidence document text

- Update `analyzeItem` signature: `async function analyzeItem(item: QuestionnaireItem, evidence?: EvidenceContext[]): Promise<ItemAnalysis>`
- Extend `detectDataCategories` to also scan evidence document text (concatenate all `EvidenceContext.text` into the combined string)
- Update `assessEvidence` to also search actual document text:
  - Build `docText` from `evidence?.map(e => e.text).join('\n') ?? ''` (lowercased)
  - If `docText` contains concrete signals (`soc 2 type ii`, `iso 27001`, `certificate number`, `aes-256`, `tls 1.`, `penetration test`, `audit report`, specific dates) AND the item has any evidence metadata, return `'Sufficient'` (document corroborates the claim)
  - If `docText` is non-empty but contains ONLY policy/generic language (same `genericOnly` regex), keep `'Insufficient'`
  - If evidence metadata present but no document text, keep existing logic unchanged
- Export the internal `assessEvidence` and `detectDataCategories` helpers for unit testing

#### Step 3 — Update `claudeProvider.ts` to include evidence in the prompt

- Update `analyzeItem` signature: `async function analyzeItem(item: QuestionnaireItem, evidence?: EvidenceContext[]): Promise<ItemAnalysis>`
- Build an evidence block from the context (cap each file at 2 000 chars, limit to first 5 files):
  ```typescript
  function buildEvidenceBlock(evidence: EvidenceContext[]): string {
    if (!evidence || evidence.length === 0) return '';
    const snippets = evidence.slice(0, 5).map(e => {
      const excerpt = e.text.length > 2000 ? e.text.slice(0, 2000) + '\n[truncated]' : e.text;
      return `--- [${e.name}] ---\n${excerpt}`;
    });
    return `\nEvidence documents (${evidence.length} file(s)):\n${snippets.join('\n')}`;
  }
  ```
- Append the evidence block to `userContent`
- Update the system prompt to instruct Claude: *"When evidence documents are provided, ground your `evidence_sufficiency` verdict in their content — 'Sufficient' requires a concrete finding (cert number, test result, config sample, or dated audit opinion) in the documents."*

#### Step 4 — Update `aiEngine.ts` to fetch and pass evidence

- After fetching `items`, query evidence with extracted text:
  ```typescript
  const evidenceRows = db.prepare(
    `SELECT original_name, kind, extracted_text FROM evidence_files
     WHERE assessment_id = ? AND parse_status = 'extracted' AND extracted_text IS NOT NULL`
  ).all(assessmentId) as Array<{ original_name: string; kind: string; extracted_text: string }>;

  const evidenceContext: EvidenceContext[] = evidenceRows.map(r => ({
    name: r.original_name,
    kind: r.kind as EvidenceKind,
    text: r.extracted_text,
  }));
  ```
- Pass `evidenceContext` to every `analyzeItem` call (both primary and fallback):
  ```typescript
  const analysis = await primary.analyzeItem(item, evidenceContext);
  // ...fallback:
  const analysis = await ruleEngine.analyzeItem(item, evidenceContext);
  ```
- Import `EvidenceContext` and `EvidenceKind` from `../types`

#### Step 5 — Write unit tests for the rule engine evidence path

- Create `server/test/ruleEngineEvidence.test.ts`
- Test: evidence document text containing `'soc 2 type ii'` upgrades verdict from `'Insufficient'` to `'Sufficient'`
- Test: evidence document with only policy text stays `'Insufficient'`
- Test: no evidence context falls back to existing behavior (returns `'None'` when no metadata)
- Test: `detectDataCategories` picks up PHI terms in document text even when absent from item fields
- Test: expiration check still takes precedence over document content

#### Step 6 — Run validation commands (see Validation section)

## Key Decisions & Rationale

**Evidence is passed at the assessment level (not item level).** Evidence files are not keyed to specific questionnaire items in the current schema. Passing all extracted evidence to every item keeps the schema unchanged while still enabling corroboration. The engine (rule or Claude) is responsible for deciding relevance based on content.

**Truncate evidence at 2 000 chars per file, max 5 files for Claude.** This keeps the per-call token budget manageable (~1 500 extra tokens) while capturing the most relevant content. SOC 2 opinions and ISO certificates lead with the most critical statements (scope, opinion type, audit date) — the truncation preserves these.

**Optional parameter on `analyzeItem`.** Existing callers (tests, scenarios) don't need to be updated; the absence of `evidence` is handled gracefully in both engines.

**Rule engine: only escalate to `Sufficient` when document has a concrete signal.** A policy PDF that contains "we use AES-256" without a certificate number is still `Insufficient`. The bar for `Sufficient` requires a concrete artifact phrase in the document (cert number, dated audit opinion, config sample, test result).

**Risk scoring stays deterministic.** Only `evidence_sufficiency` (and `data_categories`) feed into `scoreItem`. The score is computed from the engine's assessed `evidence_sufficiency`, not directly from the document text — ensuring the pipeline remains auditable.

**No schema change needed.** `evidence_files.extracted_text` already exists; no migration required.

## Verification

### Unit Tests & Edge Cases

- **No evidence uploaded**: `evidenceContext = []`; `assessEvidence` returns same result as before; `analyzeItem` behaves identically to the current code.
- **Evidence with strong signals**: document text contains `'soc 2 type ii'` → `evidence_sufficiency = 'Sufficient'`.
- **Evidence with generic policy text only**: document text contains only `'policy'` → `evidence_sufficiency = 'Insufficient'`.
- **Expiration still wins**: `item.expiration_date` is in the past → `'Expired'` regardless of document content.
- **Data categories from document**: evidence PDF mentions `'protected health information'` → `'phi'` added even if absent from item fields.
- **Claude prompt with evidence**: user message includes the `--- [filename] ---` block.
- **Claude prompt without evidence**: user message unchanged from current format.
- **Truncation**: a 10 000-char document is truncated to 2 000 chars with `[truncated]` suffix.

### Acceptance Criteria

1. When an assessment has an evidence file whose extracted text contains `'soc 2 type ii'`, the rule engine's `evidence_sufficiency` for a relevant item changes from `'Insufficient'` or `'None'` to `'Sufficient'`.
2. When no evidence files are uploaded, both engines produce identical output to the current code.
3. The Claude user message includes an evidence block when evidence files are present.
4. `npm run test` passes with zero failures (new `ruleEngineEvidence.test.ts` plus all existing tests).
5. `npm run typecheck` passes — `AnalysisProvider.analyzeItem` signature updated in both implementations.
6. `npm run build` succeeds.

### Validation Commands

```bash
# Lint + format
npm run check

# TypeScript type checks (server + client)
npm run typecheck

# All unit tests (including new ruleEngineEvidence.test.ts)
npm run test

# Client production build
npm run build
```

## Known Limitations / Follow-ups

- **Item-level evidence association**: the current schema links evidence at the assessment level. A future issue could add a junction table (`evidence_item_links`) to let analysts tag which document supports which answer, enabling per-item relevance without passing all documents to every call.
- **Image evidence**: images have `parse_status = 'no_text'` and no `extracted_text`; they are correctly excluded from the evidence context (the query filters on `parse_status = 'extracted'`). OCR support is a future concern.
- **Very large evidence sets**: the 5-file / 2 000-char cap is conservative. If an assessment has 20 evidence files, only the first 5 (by upload order) are included in the Claude call. A smarter relevance-based selection (e.g., embedding cosine similarity) is a follow-up.
- **Legacy `.doc` files**: `parse_status = 'unsupported'` — excluded from context, same as images.
