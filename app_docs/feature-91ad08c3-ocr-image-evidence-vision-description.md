# OCR / Image Evidence Vision Description

**ADW ID:** 91ad08c3
**Date:** 2026-05-28
**Plan-Spec:** specs/adw/issue-45-adw-91ad08c3-ocr-parse-image-evidence-plan.md

## Overview

Uploaded screenshots, architecture diagrams, and other image evidence files are now described by the Claude Vision API rather than silently skipped. The AI-generated description is fed into the analysis pipeline alongside parsed PDF and spreadsheet text, improving `evidence_sufficiency` scoring and giving analysts machine-readable content for every image file. SVG files are handled separately by extracting their XML markup directly, without incurring Vision API tokens.

## What Was Built

- `describeImageWithVision` — async function that calls the Claude Vision API (Haiku model) to produce a structured description of JPEG, PNG, GIF, and WebP evidence images
- `extractSvg` — synchronous function that reads SVG files as UTF-8 markup and returns them as extracted text
- Updated `extractEvidence` routing so images pass through vision or SVG extraction before falling back to the original `no_text` stub
- AI provenance chip in `EvidencePanel` — a branded "AI described" badge shown on image evidence items whose `parse_status` is `extracted`
- Context-aware button labels — "Show AI description" / "Hide AI description" for vision-described images instead of the generic "Show extracted text"
- Demo evidence seeded for the `trustvault` scenario (ISO 27001 certificate PNG + pentest PDF) so the provenance chip is exercised by UX regression tests
- New UX scenario `evidence-panel-vision` added to the regression manifest
- E2E test spec covering the full upload-to-description flow (`.claude/commands/e2e/test_ocr_image_evidence.md`)

## Technical Implementation

### Files Modified

- `server/src/services/evidenceExtraction.ts`: added `describeImageWithVision`, `extractSvg`, vision constants (`VISION_MIMES`, `VISION_MAX_BYTES`, `VISION_MODEL`), test seam `_testHooks`, and updated `extractEvidence` `case 'image':` branch
- `client/src/components/EvidencePanel.tsx`: added `isAiDescription` derivation, AI provenance chip markup, and context-aware show/hide button labels
- `server/src/services/demo.ts`: seeds two demo evidence rows (PNG image + PDF) on the `trustvault` scenario load for UX test coverage
- `server/test/evidenceExtraction.test.ts`: updated existing no-API-key assertion; added vision success, oversized-image skip, BMP fallback, SVG extraction, and API-error fallback tests
- `server/test/evidenceExtractionVision.test.ts`: dedicated test file covering `describeImageWithVision` via the `_testHooks` mock seam
- `e2e/ux/scenarios.ts`: added `evidence-panel-vision` scenario (all viewports, axe + overflow + console-error invariants)
- `.claude/commands/e2e/test_ocr_image_evidence.md`: new E2E test spec for the image OCR flow

### Key Changes

- **Vision routing:** `extractEvidence` now routes `image/svg+xml` and `.svg` files to `extractSvg`, then attempts `describeImageWithVision` for supported MIME types, falling back to the original `describeImage` stub when the API key is absent, the MIME is unsupported, the file exceeds 3.75 MB, or the API call throws.
- **Graceful degradation:** all failure paths return `null` from `describeImageWithVision`, preserving the offline-friendly `no_text` behaviour for local dev and deployments without an Anthropic API key.
- **Test seam:** `_testHooks.createAnthropicClient` is exported so unit tests can inject a mock client without module-level patching; production code always gets `new Anthropic({ apiKey })`.
- **AI provenance chip:** follows the design-system AI-attribution pattern — `bg-brand-50 text-brand-700 ring-brand-100` tokens with a star SVG icon and the label "AI described".
- **Model selection:** defaults to `claude-haiku-4-5-20251001` (fast and cheap); overridable via the `VISION_MODEL` environment variable.

## How to Use

1. Open an assessment detail page and click **Add evidence**.
2. Upload a PNG, JPEG, GIF, or WebP file (under 3.75 MB) while `ANTHROPIC_API_KEY` is set in the server environment.
3. The evidence row appears with a green "Text extracted" status badge and a blue "AI described" provenance chip.
4. Click **Show AI description** to expand the structured description (text, charts, architecture relationships, compliance indicators).
5. Run a new analysis — the description is automatically included in the evidence context fed to the analysis engine.

For SVG uploads, the XML markup is extracted directly without calling the Vision API; the evidence row shows "Text extracted" without the "AI described" chip.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | _(none)_ | Required to enable vision descriptions. Absent → images fall back to `no_text`. |
| `VISION_MODEL` | `claude-haiku-4-5-20251001` | Claude model used for image descriptions. Override to `claude-sonnet-4-6` for higher-quality descriptions at greater cost. |

No database migrations are required. The existing `evidence_files` schema already stores `parse_status`, `extracted_text`, `extracted_chars`, and `parse_note`.

## Testing

```bash
# Type checks
npm run typecheck

# Server unit tests (evidenceExtraction + vision tests)
npm --prefix server test

# Full validation suite
npm run check && npm run build

# UX regression (includes evidence-panel-vision scenario)
npm run test:ux

# E2E — image OCR flow
# Read .claude/commands/test_e2e.md, then execute
# .claude/commands/e2e/test_ocr_image_evidence.md
```

## Notes

- AI-generated image descriptions are preliminary inputs to risk analysis. The final vendor-risk decision is always made by a human analyst, never automatically by the AI.
- Images between 3.75 MB and the 25 MB upload limit fall back to `no_text`; a follow-up could resize with `sharp` before calling Vision.
- Legacy `.doc` files remain `unsupported`; adding `word-extractor` support is a separate follow-up.
- Concurrent bulk uploads of many images may approach Anthropic rate limits; each file's `try/catch` already handles this by falling back to `no_text` without failing the upload.
- Vision token cost: ~$0.001 per image at default Haiku pricing; ~$0.02 for a 20-file upload batch.
