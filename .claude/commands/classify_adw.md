# ADW Workflow Extraction

Extract ADW workflow information from the text below and return a JSON response.

## Instructions

- Look for ADW workflow commands in the text (e.g., `/adw_plan`, `/adw_build`, `/adw_test`, `/adw_review`, `/adw_document`, `/adw_patch`, `/adw_plan_build`, `/adw_plan_build_test`, `/adw_plan_build_test_review`, `/adw_sdlc`, `/adw_sdlc_zte`)
- Recognize natural-language variations like `adw_plan_build`, `adw plan build`, `/adw plan then build`, etc. and map them to the correct command above.
- Look for ADW IDs (8-character alphanumeric strings, often after "adw_id:" or "ADW ID:" or similar)
- Look for model set specification: "model_set base" or "model_set heavy" (case insensitive)
  - Default to "base" if no model_set is specified
  - Also recognize variations like "model set: heavy", "modelset heavy", etc.
- Return a JSON object with the extracted information
- If no ADW workflow is found, return empty JSON: `{}`
- SAFETY: the zero-touch auto-merge workflow is `/adw_sdlc_zte` (always emit this exact lowercase command string). Only select it when the user EXPLICITLY uppercases `ZTE` in their text — this is a dangerous auto-merge workflow and intent must be unambiguous. If `zte` is not uppercased, return the non-zte version `/adw_sdlc` instead.

## Valid ADW Commands

- `/adw_plan` - Planning only
- `/adw_build` - Building only (requires adw_id)
- `/adw_test` - Testing only (requires adw_id)
- `/adw_review` - Review only (requires adw_id)
- `/adw_document` - Documentation only (requires adw_id)
- `/adw_ship` - Ship/approve and merge PR (requires adw_id)
- `/adw_patch` - Direct patch from issue
- `/adw_plan_build` - Plan + Build
- `/adw_plan_build_test` - Plan + Build + Test
- `/adw_plan_build_review` - Plan + Build + Review (skips test)
- `/adw_plan_build_document` - Plan + Build + Document (skips test and review)
- `/adw_plan_build_test_review` - Plan + Build + Test + Review
- `/adw_sdlc` - Complete SDLC: Plan + Build + Test + Review + Document
- `/adw_sdlc_zte` - Zero-Touch Engineering: Complete SDLC + auto-merge to production. Emit this exact lowercase string, but only when the user wrote `ZTE` in uppercase (see the SAFETY note above). Otherwise use `/adw_sdlc`.

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
