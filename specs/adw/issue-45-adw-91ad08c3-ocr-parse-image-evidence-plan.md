# Spec — OCR / parse image evidence (screenshots, architecture diagrams)

- **Status:** Draft
- **Branch:** feat-issue-45-adw-91ad08c3-ocr-parse-image-evidence
- **Location:** `server/src/services/evidenceExtraction.ts`, `server/test/evidenceExtraction.test.ts`, `client/src/components/EvidencePanel.tsx`, `e2e/ux/scenarios.ts`, `.claude/commands/e2e/test_ocr_image_evidence.md`
- **Related docs:** `specs/0008-zte-agentic-layer.md`, `specs/0014-design-system.md`, `specs/adw/issue-43-adw-d1667986-feed-evidence-text-to-analysis-plan.md`, `API_CONTRACT.md`, `README.md`

## Problem / Objective

**User Story:** As an analyst reviewing a vendor's evidence, I want uploaded screenshots and architecture diagrams to be described by AI so that their content informs the risk analysis — rather than sitting as opaque blobs with status "No text."

**Problem Statement:** `server/src/services/evidenceExtraction.ts:163-173` (`describeImage`) always returns `status: 'no_text'` and `text: ''` for images. The `aiEngine.ts` query filters `WHERE parse_status = 'extracted'`, so image evidence is silently excluded from the analysis pipeline even when it contains security-relevant information (SOC 2 certificates, architecture diagrams, MFA policy screenshots, etc.). This gap degrades `evidence_sufficiency` scoring and leaves analysts without machine-readable image content.

The same file at lines 120-130 also marks legacy `.doc` files as `unsupported` — a lower-priority concern addressed as an optional stretch goal in this spec.

## Approach & Changes

Use the **Claude Vision API** (via the existing `@anthropic-ai/sdk` dependency) to generate a structured description of each uploaded image. This is consistent with the app's existing Claude integration, requires no new heavy dependencies, and produces high-quality descriptions of both text-heavy screenshots and non-textual architecture diagrams.

**Key files and why they matter:**

- `server/src/services/evidenceExtraction.ts` — sole owner of evidence parsing logic; `describeImage` and `extractEvidence` are the two functions to update.
- `server/test/evidenceExtraction.test.ts` — existing test at line 63 asserts `status: 'no_text'` for images; must be updated to cover both paths (with and without API key).
- `client/src/components/EvidencePanel.tsx` — renders the evidence list; vision-described images should display an AI-provenance indicator per the design system's attribution pattern (spec 0014).
- `e2e/ux/scenarios.ts` — UX regression manifest; add an evidence-panel scenario.
- `.claude/commands/e2e/test_ocr_image_evidence.md` — new E2E test covering the full upload-to-description flow.

**Vision API constraints:**
- Supported MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.
- Not supported by Claude Vision: `image/bmp`, `image/tiff`, `image/svg+xml` — fall back gracefully to existing `no_text` for these.
- SVG is XML text; extract its markup directly as an alternative to vision.
- Max image size: ~3.75 MB raw (≈5 MB base64) — skip vision for oversized images, fall back to `no_text`.
- Vision is only enabled when `ANTHROPIC_API_KEY` is set; if absent the existing offline behaviour is preserved exactly.

### New Files

- `.claude/commands/e2e/test_ocr_image_evidence.md` — E2E test spec for the image OCR flow.

### Implementation Plan

**Phase 1 — Foundation (server-side extraction)**
Add `describeImageWithVision` as a new async function in `evidenceExtraction.ts`. It reads `ANTHROPIC_API_KEY`, short-circuits to `null` when absent, and calls the Claude Vision API with a vendor-risk–focused prompt. Returns an `EvidenceExtractionResult` with `status: 'extracted'` on success, or `null` so the caller can fall back.

**Phase 2 — Core Integration**
- Update `extractEvidence` `case 'image':` to `await describeImageWithVision(buf, mimeType) ?? describeImage(buf)` (convert `extractEvidence` switch to `async` where needed — it already is).
- Handle SVG as a text extraction special case (parse markup directly).
- Existing `describeImage` remains the sync offline fallback.

**Phase 3 — Client + Tests**
- Update `EvidencePanel.tsx` to show an AI-provenance chip for `kind === 'image' && parse_status === 'extracted'` entries (per design-system AI-attribution pattern). Change the button label from "Show extracted text" to "Show AI description" for images.
- Update the existing image unit test (now expects `no_text` without an API key — keep that assertion). Add new tests with a mocked Anthropic client covering the vision path, the SVG path, the oversized-image skip, and the API-failure fallback.
- Add UX scenario to `e2e/ux/scenarios.ts`.
- Create E2E test file.

### Step by Step Tasks

#### Step 1 — Read design system docs before any UI change

- Invoke the `design-system` skill (`.claude/skills/design-system/`) and read `design-system/DESIGN_SYSTEM.md`.
- Note the AI-attribution provenance pattern (chip shape, icon, copy rules) to apply in Step 6.

#### Step 2 — Create the E2E test file

- Read `.claude/commands/test_e2e.md` and `.claude/commands/e2e/test_basic_assessment.md` to understand the E2E test format.
- Create `.claude/commands/e2e/test_ocr_image_evidence.md` with tests covering:
  1. Upload a PNG screenshot as evidence → evidence panel shows green "AI description" badge with character count.
  2. Uploaded image text/description is included in the analysis context (verify `evidence_sufficiency` is not "None" when a description was extracted).
  3. Without `ANTHROPIC_API_KEY`, uploaded image shows gray "No text" badge (offline fallback).
  4. BMP/TIFF image upload (unsupported by Vision) falls back to "No text" gracefully.
  5. SVG file upload yields "Text extracted" (SVG markup read directly).

#### Step 3 — Add `describeImageWithVision` to `evidenceExtraction.ts`

- Import `Anthropic` from `@anthropic-ai/sdk` at the top of the file.
- Add the constant `VISION_MIMES` (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) and `VISION_MAX_BYTES = 3_750_000`.
- Add `VISION_MODEL = process.env.VISION_MODEL ?? 'claude-haiku-4-5-20251001'` (same pattern as `MODEL` in `claudeProvider.ts`).
- Implement `async function describeImageWithVision(buf: Buffer, mimeType: string): Promise<EvidenceExtractionResult | null>`:
  - Return `null` immediately when `ANTHROPIC_API_KEY` is absent.
  - Return `null` when `mimeType` is not in `VISION_MIMES` (caller will fall back to `describeImage`).
  - Return `null` when `buf.length > VISION_MAX_BYTES`.
  - Create `new Anthropic({ apiKey })` and call `client.messages.create` with the image content block and a vendor-risk–focused system instruction: extract all readable text verbatim, describe charts/tables with values, describe architecture components and their relationships, note security certifications and compliance indicators.
  - On success: call `clip()` on the returned text and return `{ kind: 'image', status: 'extracted', text, chars, note: \`Vision description${dim}${truncated ? \`; truncated to ${MAX_TEXT} chars\` : ''}\` }`.
  - On any caught error: log `console.error('[evidenceExtraction] vision failed:', err.message)` and return `null` so the caller falls back silently.

- Add `function extractSvg(buf: Buffer): EvidenceExtractionResult`:
  - Parse SVG buffer as UTF-8; call `clip()`.
  - Return `{ kind: 'image', status: text ? 'extracted' : 'empty', text, chars, note: 'SVG markup extracted.' }`.

#### Step 4 — Update `extractEvidence` to use vision

- In the `case 'image':` branch, replace `return describeImage(buf)` with:
  ```
  if (mimeType === 'image/svg+xml' || ext === '.svg') return extractSvg(buf);
  return (await describeImageWithVision(buf, mimeType)) ?? describeImage(buf);
  ```
- The function signature and outer try/catch remain unchanged.

#### Step 5 — Update server unit tests

- In `server/test/evidenceExtraction.test.ts`:
  - **Existing test** at line 63: rename to "image falls back to no_text when ANTHROPIC_API_KEY is absent" — ensure `delete process.env.ANTHROPIC_API_KEY` is set for that test case, then restore.
  - **New test** "describeImageWithVision returns extracted text on success": mock the Anthropic SDK client using `node:test` mocking or a stub, inject a fake description, assert `status === 'extracted'` and `text` contains the fake description.
  - **New test** "image vision skips oversized images and falls back to no_text": create a dummy buffer > 3.75 MB, assert `status === 'no_text'`.
  - **New test** "BMP image falls back to no_text (unsupported MIME)": pass `image/bmp`, assert `status === 'no_text'`.
  - **New test** "SVG image yields extracted markup": create a minimal SVG buffer, assert `status === 'extracted'` and `text` includes `<svg`.
  - **New test** "vision API error falls back to no_text": make the mock throw, assert `status === 'no_text'`.

#### Step 6 — Update `EvidencePanel.tsx` with AI provenance indicator

- Invoke design-system skill first (Step 1) and follow the AI-attribution provenance pattern.
- In `EvidenceItem`:
  - Derive `isAiDescription = ev.kind === 'image' && ev.parse_status === 'extracted'`.
  - Add an AI provenance chip (small `inline-flex` badge using design-system tokens) next to the status badge when `isAiDescription` is true. Label: "AI described".
  - Change the show/hide button label: `isAiDescription ? 'Show AI description' : 'Show extracted text'` (and the hide variant accordingly).
  - Update `sr-only` spans for accessibility.
- In `EvidencePanel`:
  - Update the summary line: count vision-described images separately if useful, or keep the existing "N parsed with extractable text" — no change required if the count already covers them.
- Keep `STATUS_LABEL['extracted']` as "Text extracted" (unchanged default); the AI chip provides the additional signal for images.

#### Step 7 — Extend `e2e/ux/scenarios.ts`

- Add a new `UxScenario` entry with id `evidence-panel-vision`:
  - Role: `Analyst`
  - Steps: `loadScenario` → `expectVisibleText` "Evidence files"
  - Invariants: `noHorizontalOverflow`, `axeClean`, `noConsoleErrors`
  - Viewports: `['mobile', 'tablet', 'desktop']`

#### Step 8 — Run validation

- Execute all validation commands from the `Validation Commands` section below.

## Key Decisions & Rationale

| Decision | Rationale | Rejected alternative |
|---|---|---|
| Claude Vision API (not Tesseract.js) | App already requires `ANTHROPIC_API_KEY`; no new runtime dependency; better accuracy on architectural diagrams and non-Latin text | Tesseract.js: heavy binary (~20 MB), poorer diagram comprehension, offline-only but OCR quality is worse |
| Graceful degradation when no API key | Preserves offline-friendly behaviour for local dev and deployments without Claude access | Hard-require vision (breaks offline dev) |
| Haiku model for vision (`claude-haiku-4-5-20251001`) | Fast and cheap; description quality is sufficient for evidence context; configurable via `VISION_MODEL` env var | Sonnet: higher cost per image upload, latency on large batches |
| 3.75 MB size cap before vision | Keeps base64 payload safely under the 5 MB API limit; large images are rare in vendor evidence packages | No cap (risk of 400 from API on large screenshots) |
| SVG extracted as markup, not via vision | SVG is UTF-8 XML; no vision tokens needed; the markup itself is machine-readable text | Vision API for SVG (extra cost, Claude Vision doesn't support SVG MIME) |
| Fall back silently on vision errors | One bad image should not fail the entire upload; `no_text` status is an honest signal | Surface error to upload response (would block valid uploads) |
| AI provenance chip in `EvidencePanel` | Design system requires attribution for AI-generated content; image descriptions are generated, not extracted | No attribution (violates design-system spec 0014) |

## Verification

### Unit Tests & Edge Cases

Tests in `server/test/evidenceExtraction.test.ts` must cover:

- `describeImageWithVision` returns `null` (→ `no_text` fallback) when `ANTHROPIC_API_KEY` is absent.
- `describeImageWithVision` returns `null` for `image/bmp` and `image/tiff` MIMEs.
- `describeImageWithVision` returns `null` for images > 3.75 MB.
- `describeImageWithVision` returns `{ status: 'extracted' }` with description text when the API mock returns a valid response.
- `describeImageWithVision` returns `null` (→ `no_text` fallback) when the Anthropic client throws.
- `extractSvg` returns `{ status: 'extracted' }` with SVG markup for a valid SVG buffer.
- `extractSvg` returns `{ status: 'empty' }` for an empty SVG buffer.
- Existing tests for CSV, Excel, Word, PDF, unsupported types — all must continue to pass unchanged.

### Acceptance Criteria

1. An uploaded PNG/JPG/GIF/WebP screenshot yields `parse_status = 'extracted'` and non-empty `extracted_text` containing a structured AI description when `ANTHROPIC_API_KEY` is set.
2. The extracted description is included in the analysis pipeline (`aiEngine.ts` query picks it up via `parse_status = 'extracted'`).
3. When `ANTHROPIC_API_KEY` is absent, uploaded images yield `parse_status = 'no_text'` exactly as before (no regression for offline dev).
4. BMP and TIFF images yield `parse_status = 'no_text'` (vision not supported; graceful fallback).
5. SVG files yield `parse_status = 'extracted'` with the SVG XML markup as text.
6. Images > 3.75 MB yield `parse_status = 'no_text'` (skipped to avoid API size limit).
7. A vision API failure (network error, quota) does not fail the upload; the evidence row is saved with `parse_status = 'no_text'`.
8. `EvidencePanel` shows an "AI described" provenance chip for `kind === 'image' && parse_status === 'extracted'` entries.
9. All existing server and client tests pass.

### UX Scenarios, Acceptance & Evidence Checklist

**Scope:** `EvidencePanel` component, evidence upload flow on the assessment detail page.

**UX Scenarios:**

| ID | Route / Flow | Viewports |
|---|---|---|
| `evidence-panel-vision` | Load showcase assessment → Assessment detail page showing evidence panel with at least one AI-described image | mobile 375, tablet 768, desktop 1280 |

**Measurable UX acceptance criteria:**

1. No horizontal overflow at 375 px when the AI provenance chip is rendered alongside the status badge.
2. The AI provenance chip is visible and legible at all three viewport widths.
3. axe: no new serious/critical WCAG 2A/AA violations introduced by the provenance chip or updated button labels.
4. Focus ring is visible on the "Show AI description" toggle button.
5. `aria-expanded` is correctly set on the toggle button (matches open/closed state).

**Before/after screenshots `/ux_validate` must capture:**

- Before: evidence item showing gray "No text" badge for an image file.
- After: evidence item showing green "Text extracted" badge + "AI described" provenance chip + "Show AI description" button.

**Task:** Extend `e2e/ux/scenarios.ts` with the `evidence-panel-vision` scenario (Step 7 above), then run `npm run test:ux`.

### Validation Commands

```bash
# 1. Lint + format
npm run check

# 2. TypeScript type checks (server + client)
npm run typecheck

# 3. Server unit tests (covers new evidenceExtraction tests)
npm run test

# 4. Client production build
npm run build

# 5. UX regression suite
npm run test:ux

# 6. E2E test — image evidence OCR flow
# Read .claude/commands/test_e2e.md, then read and execute
# .claude/commands/e2e/test_ocr_image_evidence.md
```

## Known Limitations / Follow-ups

- **Legacy `.doc` not in scope for this iteration.** The issue marks it optional. A follow-up could use the `word-extractor` npm package (handles `.doc` without system binaries) to add `status: 'extracted'` for `.doc` files.
- **Vision token cost.** Each image upload consumes Haiku tokens. At the default cap (3.75 MB) with a 1 024-token response, cost is ~$0.001/image. For bulk uploads (up to 20 files at once per the upload route), this is ~$0.02/upload batch — acceptable.
- **Large image downscaling not implemented.** Images between 3.75 MB and 25 MB (the upload limit) silently fall back to `no_text`. A follow-up could resize with `sharp` before calling Vision.
- **PDF scans (image-based PDFs).** `extractPdf` already produces a `no_text` result for scanned PDFs. A follow-up could render the first page as a PNG via `pdf2pic` and then call `describeImageWithVision`.
- **Rate limiting.** Concurrent uploads of many images could hit Anthropic rate limits. The existing per-file `try/catch` already handles this gracefully (falls back to `no_text`).
