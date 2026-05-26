# ADW Workflow Extraction

Extract ADW workflow information from the text below and return a JSON response.

## Instructions

- Look for ADW workflow commands in the text (e.g., `/adw_plan_iso`, `/adw_build_iso`, `/adw_test_iso`, `/adw_review_iso`, `/adw_document_iso`, `/adw_patch_iso`, `/adw_plan_build_iso`, `/adw_plan_build_test_iso`, `/adw_plan_build_test_review_iso`, `/adw_sdlc_iso`, `/adw_sdlc_zte_iso`)
- Also recognize commands without the `_iso` suffix and automatically add it (e.g., `/adw_plan` → `/adw_plan_iso`)
- Also recognize variations like `adw_plan_build`, `adw plan build`, `/adw plan then build`, etc. and map to the correct command
- Look for ADW IDs (8-character alphanumeric strings, often after "adw_id:" or "ADW ID:" or similar)
- Look for model set specification: "model_set base" or "model_set heavy" (case insensitive)
  - Default to "base" if no model_set is specified
  - Also recognize variations like "model set: heavy", "modelset heavy", etc.
- Return a JSON object with the extracted information
- If no ADW workflow is found, return empty JSON: `{}`
- SAFETY: the zero-touch auto-merge workflow is `/adw_sdlc_zte_iso` (always emit this exact lowercase command string). Only select it when the user EXPLICITLY uppercases `ZTE` in their text — this is a dangerous auto-merge workflow and intent must be unambiguous. If `zte` is not uppercased, return the non-zte version `/adw_sdlc_iso` instead.

## Valid ADW Commands

- `/adw_plan_iso` - Planning only
- `/adw_build_iso` - Building only (requires adw_id)
- `/adw_test_iso` - Testing only (requires adw_id)
- `/adw_review_iso` - Review only (requires adw_id)
- `/adw_document_iso` - Documentation only (requires adw_id)
- `/adw_ship_iso` - Ship/approve and merge PR (requires adw_id)
- `/adw_patch_iso` - Direct patch from issue
- `/adw_plan_build_iso` - Plan + Build
- `/adw_plan_build_test_iso` - Plan + Build + Test
- `/adw_plan_build_review_iso` - Plan + Build + Review (skips test)
- `/adw_plan_build_document_iso` - Plan + Build + Document (skips test and review)
- `/adw_plan_build_test_review_iso` - Plan + Build + Test + Review
- `/adw_sdlc_iso` - Complete SDLC: Plan + Build + Test + Review + Document
- `/adw_sdlc_zte_iso` - Zero-Touch Engineering: Complete SDLC + auto-merge to production. Emit this exact lowercase string, but only when the user wrote `ZTE` in uppercase (see the SAFETY note above). Otherwise use `/adw_sdlc_iso`.

## Response Format

Respond ONLY with a JSON object in this format:
```json
{
  "adw_slash_command": "/adw_plan",
  "adw_id": "abc12345",
  "model_set": "base"
}
```

Fields:
- `adw_slash_command`: The ADW command found (include the slash)
- `adw_id`: The 8-character ADW ID if found
- `model_set`: The model set to use ("base" or "heavy"), defaults to "base" if not specified

If only some fields are found, include only those fields.
If nothing is found, return: `{}`
IMPORTANT: Always include `model_set` with value "base" if no model_set is explicitly mentioned in the text.

## Text to Analyze

$ARGUMENTS
