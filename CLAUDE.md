# CLAUDE.md

Guidance for working in this repository.

## Project

Vendor Risk Portal — an AI-assisted tool for reviewing vendor security/privacy
questionnaires. **Express + SQLite** backend (`server/`) and a **React + Vite +
Tailwind** SPA (`client/`). The final vendor-risk decision is always made by a human
analyst, never automatically by the AI.

- Architecture, conventions, and history live in **`specs/`** (numbered design docs)
  and **`README.md`**. Read the relevant spec before changing an area.
- Frontend design language: slate / `brand` palette, Inter, shared `card` / `btn-*` /
  `input` / `label` utilities in `client/src/index.css`. Mobile-first Tailwind.

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

## Build & verify

- Client: `cd client && npm run build` (`tsc --noEmit && vite build`).
- Server typecheck: `npm --prefix server run typecheck`; tests: `npm --prefix server test`.
- Node is pinned to **22.18.0** (`.nvmrc`) — the version Cloudflare Pages / Render CI use.
