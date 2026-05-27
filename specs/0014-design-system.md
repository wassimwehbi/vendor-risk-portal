# 0014 — Design system: codify, self-host fonts, ship the brand mark, enforce going forward

- **Status:** Proposed
- **Branch:** `feat/0014-design-system`
- **Location (files touched):**
  - `design-system/DESIGN_SYSTEM.md`, `design-system/colors_and_type.css` — committed reference (new)
  - `.claude/skills/design-system/SKILL.md` — Agent Skill (new)
  - `client/public/fonts/Inter-*.woff2` — self-hosted Inter (new, 5 files)
  - `client/src/index.css` — `@font-face` declarations
  - `client/src/components/BrandMark.tsx` — shield + check logo (new)
  - `client/src/components/Layout.tsx`, `client/src/pages/Login.tsx`,
    `client/src/pages/InviteAccept.tsx` — swap `VR` monogram for `BrandMark`
  - `CLAUDE.md` — point contributors/agents at the design system
- **Related docs:** `specs/0012-ux-tasks-harness.md` (the `ux` gate that enforces visuals),
  `design-system/DESIGN_SYSTEM.md`, `client/tailwind.config.js`, `client/src/index.css`

## Problem / objective

The product's visual language was well-established in code (`tailwind.config.js`,
`index.css`, the components) but only **implicitly** — there was no single written
source of truth, and nothing that makes new features (hand-authored or ADW-generated)
follow it automatically. A design system was produced in **Claude Design** by
reverse-engineering this repo; this work brings it back in.

Two goals:

1. **Use it here.** Apply the genuine deltas between the design system and the shipped
   app (the rest already matched verbatim).
2. **Follow it going forward.** Make the design system a durable, discoverable, and
   *enforced* source of truth for all future UI work.

## Approach & changes

The Claude Design handoff was reverse-engineered from this repo, so its tokens
(`brand` steel scale, slate foundation, `shadow-card`, radii/spacing, the
`.card`/`.btn-*`/`.input`/`.label` recipes) **already matched `tailwind.config.js` and
`index.css` exactly**. This was therefore *not* a recolor. Only two visual deltas were
real:

1. **Self-hosted Inter.** The app set `font-family: Inter, …` but shipped no `@font-face`,
   so Inter rendered only if the viewer's OS happened to have it; otherwise it silently
   fell back to `system-ui`. Added the five `Inter-*.woff2` files (4 static weights +
   variable) under `client/public/fonts/` and `@font-face` declarations
   (`font-display: swap`) in `client/src/index.css`, referenced via absolute `/fonts/…`
   URLs (Vite serves `public/` at the web root).

2. **Brand mark.** Replaced the `VR` text monogram (`Layout.tsx`, `Login.tsx`,
   `InviteAccept.tsx`) with a shield + inset-checkmark SVG (`BrandMark.tsx`). The shield
   nods to the security domain; the white check nods to the human-validation theme. The
   SVG carries its own shape, so the old background/border-radius wrapper is gone. Colors
   use Tailwind `fill-brand-600`/`stroke-brand-700` utilities so the mark tracks the
   palette.

To make the system **followed going forward** (the high-value half):

- **Committed reference:** `design-system/DESIGN_SYSTEM.md` (full guide) +
  `design-system/colors_and_type.css` (token reference) are the human-discoverable source
  of truth at the repo root.
- **Agent Skill:** `.claude/skills/design-system/SKILL.md` auto-loads for any UI work and
  instructs the agent to read `DESIGN_SYSTEM.md` first, listing the non-negotiables
  (one accent, soft-tinted pills, mandatory AI-attribution chips, restraint rules,
  sentence-case voice, a11y).
- **`CLAUDE.md`** points every contributor and ADW run at the design system + skill.
- **Enforcement:** the existing `ux` required check (spec 0012, Playwright + axe + visual
  baselines) is the automated gate — UI that drifts from the baselines fails CI.

## Key decisions & rationale

- **Deltas only, not a full re-skin.** Since tokens already matched, recoloring would have
  been churn with no visual change. Scope was limited to the two real deltas.
- **Stay Tailwind-native; did not adopt the 91-token CSS-variable layer.** The repo already
  has a working single source of truth in `tailwind.config.js`. A parallel `:root` variable
  layer would duplicate it and risk drift. The committed `colors_and_type.css` is reference,
  not wired into the build.
- **Fonts in `public/`, not `src/` imports.** Avoids per-build hashing and keeps the
  `@font-face` URLs stable and human-legible.
- **Brand mark via Tailwind `fill-`/`stroke-` utilities** (not `var(--brand-600)`), because
  this repo has no CSS-variable token layer — a `var()` would silently fall back.
- **Design system as an Agent Skill**, matching the handoff's intended `SKILL.md` pattern
  and this repo's ADW/Claude Code workflow, so design adherence is a standing instruction
  rather than a one-off.

## Verification

- `cd client && npm run build` (`tsc --noEmit && vite build`) passes on Node 22.18.x.
- `dist/fonts/Inter-*.woff2` are emitted and the built CSS references all five faces.
- `BrandMark` renders in the header (28px) and the login/invite cards (44px); imports wired
  in all three call sites.
- Manual: brand mark shows steel shield + white check; Inter renders without a system Inter
  install.

## Known limitations / follow-ups

- **UX visual baselines must be regenerated on CI** after this change — the new logo and
  self-hosted font alter rendered pixels. Baselines are Linux-only (regenerated on CI, see
  prior commit "regenerate visual baselines on Linux CI"); do not regenerate on macOS.
- **Lucide icons** were deliberately deferred. The design system commits to Lucide (v0); the
  app has not adopted it. A follow-up spec can introduce the `Icon` component and migrate the
  hand-built SVGs (menu / Google / Microsoft).
- **`brand-800`** appears in the handoff's `styles.css` (`#2a3447`) but not in
  `tailwind.config.js` (and the values differ slightly from the README's `#2b3645`). Left
  out — unused by these deltas; add to the config if a future component needs it.
- The committed `design-system/` reference is a point-in-time snapshot; when the visual
  language changes, update `DESIGN_SYSTEM.md` in the same PR.
