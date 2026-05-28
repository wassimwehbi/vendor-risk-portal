# CLAUDE.md

Guidance for working in this repository.

## Project

Vendor Risk Portal — an AI-assisted tool for reviewing vendor security/privacy
questionnaires. **Express + SQLite** backend (`server/`) and a **React + Vite +
Tailwind** SPA (`client/`). The final vendor-risk decision is always made by a human
analyst, never automatically by the AI.

- Architecture, conventions, and history live in **`specs/`** (numbered design docs)
  and **`README.md`**. Read the relevant spec before changing an area.
- **Design system — REQUIRED for ALL UI work (blocking).** Before creating or changing ANY UI —
  in `client/` **or** the `portal/` experiments app, including React components, pages, Tailwind
  classes, or CSS — you **MUST** invoke the **`design-system` skill** (`.claude/skills/design-system/`)
  and follow **`design-system/DESIGN_SYSTEM.md`**, the source of truth for the visual language
  (slate / `brand` tokens, Inter, the `card` / `btn-*` / `input` / `label` recipes, the
  AI-attribution provenance pattern, iconography, and voice/copy). Concretely:
  - Reuse the shared tokens + recipes; **never re-implement tokens or hardcode palette values**.
    `client/` uses `client/tailwind.config.js` + `client/src/index.css`; `portal/` imports the
    canonical tokens from `design-system/colors_and_type.css`.
  - Use the **`BrandMark`** component for the logo — never a text monogram or an ad-hoc mark.
  - Mobile-first; sentence-case copy; no new emoji. See `specs/0014-design-system.md`.

## Pull requests — a spec is required

**Every PR MUST include a spec file in `specs/`** — either a new spec or an update to an
existing one. No PR should be opened without one.

- **Location & naming:** `specs/NNNN-short-slug.md`, where `NNNN` is the next zero-padded
  number after the highest existing spec (e.g. `0006-…`).
- **Format:** follow the existing specs (e.g. `specs/0004-…`, `specs/0005-…`). Start with a
  header block — **Status**, **Branch**, **Location** (files touched), **Related docs** —
  then sections covering the **problem/objective**, the **approach & changes**, **key
  decisions & rationale**, **verification**, and **known limitations / follow-ups**.
- A small change updates or extends the most relevant existing spec; a new feature or a
  distinct body of work gets its own numbered spec.
- The PR description should link to the spec it adds or updates.
- **ADW-generated specs** are a distinct, valid spec type. The ZTE agentic layer writes
  per-issue plan-specs to `specs/adw/issue-<n>-adw-<id>-<slug>-plan.md` (kept out of the
  curated `NNNN` namespace to avoid counter races). Hand-authored design docs keep the
  `specs/NNNN-short-slug.md` convention.

## ZTE agentic layer (`adws/`)

`adws/` is a Python (`uv`) "AI Developer Workflow" layer that drives the `claude` CLI
through plan → build → test → review → document → ship for a GitHub issue. See
`specs/0008-zte-agentic-layer.md`. Trigger it three ways: locally
(`uv run adws/adw_sdlc_zte.py <issue>`), via the cron poller
(`adws/adw_triggers/trigger_cron.py`), or by labeling an issue `adw:zte` (the
`.github/workflows/adw-zte.yml` Actions "webhook"). Ship is true zero-touch: it waits for
the required checks, resolves GitHub Copilot's high-importance PR feedback, then
squash-merges. Kill-switches: the `adw:freeze` label and `ADW_DISABLED=true`.

## Build & verify

- Client: `cd client && npm run build` (`tsc --noEmit && vite build`).
- Server typecheck: `npm --prefix server run typecheck`; tests: `npm --prefix server test`.
- Node is pinned to **22.18.0** (`.nvmrc`) — the version Cloudflare Pages / Render CI use.
