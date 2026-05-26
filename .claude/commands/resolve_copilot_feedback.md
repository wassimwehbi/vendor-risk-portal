# Resolve Copilot Feedback

Analyze GitHub Copilot's PR review feedback, decide which items are high-importance, and apply minimal targeted fixes for the high-importance ones only. Follow the `Instructions` and return the result exactly as specified in the `Report` section.

## Variables

adw_id: $1
pr_number: $2
copilot_feedback_json: $3   # JSON array of {id, path, line, body, commit_id}

## Instructions

- Parse `copilot_feedback_json`. Classify each comment's severity as `high` or `low`:
  - HIGH: correctness bugs, security/privacy issues (injection, authz, secret/PII leakage — this is a vendor-risk app), crashes, null/undefined deref, data loss, broken types, regressions, failing-contract changes.
  - LOW: style, naming, nits, "consider", optional refactors, doc wording.
  - When in doubt about a security- or correctness-flavored comment, classify HIGH.
- Ground yourself: run `git diff origin/main...HEAD`.
- For each HIGH item, make the SMALLEST change that resolves it. Do not refactor beyond the comment's scope; touch only referenced files (or their direct dependencies).
- Respect repo conventions: Biome, TypeScript strict, the shared `card` / `btn-*` / `input` / `label` utilities; if behavior changes, update the relevant `specs/` file.
- Do NOT make code changes for LOW items; just acknowledge them.
- Run cheap local checks where possible: `npm run check && npm run typecheck`.

## Report (return ONLY valid JSON)

```json
{
  "addressed": [ {"comment_id": 0, "path": "...", "severity": "high", "summary": "..."} ],
  "acknowledged_low": [ {"comment_id": 0, "note": "..."} ],
  "remaining_high": [ {"comment_id": 0, "reason": "could not resolve"} ],
  "changed_files": ["..."]
}
```
