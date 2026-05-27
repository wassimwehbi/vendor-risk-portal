# UX Validate

Visually confirm — **within the ADW** — that a UX change actually rendered as intended, by capturing before/after evidence and auditing it against the plan-spec's UX acceptance criteria. Return a machine-readable verdict.

This is the qualitative complement to the deterministic `ux` regression suite: the suite proves invariants hold; this proves the *intended visual change happened* and matches what was promised.

## Variables

adw_id: $1
spec_file: $2 if provided, otherwise discover the `specs/adw/*-plan.md` from the git diff
ux_image_dir: `<absolute path to worktree>/agents/<adw_id>/ux_validator/ux_img/`

## Instructions

- Check the branch (`git branch`) and run `git diff origin/main` to see the changes.
- Read the plan-spec — especially its **"UX Scenarios, Acceptance & Evidence Checklist"** section (if present). Each acceptance criterion + required-evidence item is what you must verify.
- Capture **before/after** visual evidence of the affected flows at the relevant viewport(s) (mobile 375 / desktop 1280 at minimum for layout changes):
  - Use the **chrome-devtools MCP** tools to drive the live app and capture screenshots if available; otherwise fall back to **Playwright** (`npx playwright`).
  - BEFORE = the change absent (check out `origin/main` for the affected file, or use the committed pixel baseline if one exists); AFTER = the current branch. If you cannot produce a true BEFORE, capture only AFTER and say so in the finding.
  - Save all screenshots into `ux_image_dir` (create it if needed), numbered like `01_before_<name>.png`, `02_after_<name>.png`. Use full absolute paths.
  - IMPORTANT: BEFORE and AFTER must not be byte-identical / show the same state — if they are, that is a `blocker` finding (the change did not render).
- Also inspect, where relevant: the accessibility tree, console errors, and responsive behavior at the target viewports.
- Audit each plan acceptance criterion: did the rendered result actually satisfy it? List each in `acceptance_criteria_checked` and flag misses as findings.
- Severity: `blocker` = the intended UX change did not render, regressed a flow, or broke the human-in-the-loop / risk contract; `minor` = visible but imperfect; `info` = note.
- IMPORTANT: This is the qualitative ADVISORY layer. Be honest and specific; the deterministic `ux` CI check is the hard gate.
- IMPORTANT: Return ONLY the JSON object below (we run JSON.parse on it). No prose, no markdown fences.

## Setup

1. If `.ports.env` exists at the repo/worktree root, source it: `source .ports.env`.
2. Start the app on the worktree dev ports in the background (e.g. `nohup npm run dev > /tmp/uxval-<adw_id>.log 2>&1 &`). Defaults: backend `4100` / frontend `5173`.
3. Browse `http://localhost:<CLIENT_DEV_PORT>` and capture evidence into `ux_image_dir`.

## Report

Return exactly this JSON object:

```json
{
  "verdict": "PASS | NEEDS_FIXES | NOT_APPLICABLE",
  "summary": "string - 2-4 sentences: what UX change was expected, whether it rendered, and your overall judgment",
  "findings": [
    {
      "description": "string - what is wrong or notable",
      "severity": "info | minor | blocker",
      "evidence_path": "string - /absolute/path/to/screenshot.png (optional)"
    }
  ],
  "evidence_paths": [
    "string - /absolute/path/to/01_before_x.png",
    "string - /absolute/path/to/02_after_x.png"
  ],
  "acceptance_criteria_checked": [
    "string - each plan UX acceptance criterion and whether it was met"
  ]
}
```

- `verdict` = `NOT_APPLICABLE` if there is no user-visible change to validate; `NEEDS_FIXES` if any `blocker` finding exists; otherwise `PASS`.
