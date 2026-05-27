---
name: design-system
description: >-
  The Vendor Risk Portal visual design system — the slate foundation + single
  muted steel `brand` accent, Inter type scale, the shared component recipes
  (`card` / `btn-*` / `input` / `label` / pills / chips), the AI-attribution
  provenance pattern, iconography, and voice/copy rules. Use whenever building,
  restyling, reviewing, or adding ANY client UI (React components, pages,
  Tailwind classes) so new work matches the established product look. Read
  design-system/DESIGN_SYSTEM.md before adding or changing UI.
---

# Vendor Risk Portal — Design System

This app has one design language. Every new screen, component, or restyle must
follow it. The canonical, full reference is **`design-system/DESIGN_SYSTEM.md`**
at the repo root, with the token values in `design-system/colors_and_type.css`.
**Read `design-system/DESIGN_SYSTEM.md` before writing or changing UI.**

The tokens already live in code — do not invent new ones:

- **Colors / fonts / shadows / radii:** `client/tailwind.config.js`
  (the `brand` steel scale, `Inter`, `shadow-card`).
- **Component recipes:** `client/src/index.css`
  (`.card`, `.btn-primary/secondary/ghost/danger`, `.input`, `.label`).
- **Brand mark:** `client/src/components/BrandMark.tsx` (shield + check SVG).

## Non-negotiables (the short version)

- **Compose existing utilities.** Build UI from `.card`, `.btn-*`, `.input`,
  `.label`, and Tailwind `brand-*` / `slate-*` classes. Never hardcode hex
  colors in components — if a token is missing, add it to the Tailwind config,
  don't inline it.
- **One accent, used once or twice per view.** The steel `brand` color is for
  the single primary action, focus rings, links, the "Analyzed" chip, and AI
  attribution — never decoration. The foundation is slate.
- **Risk / evidence / status are soft-tinted pills**, never solid badges:
  `bg-{c}-50` + `text-{c}-700` + `ring-1 ring-inset ring-{c}-200`
  (Low=emerald, Medium=amber, High=orange, Critical/Expired=red).
- **AI-attribution is mandatory** on every surface that shows AI output. Each
  AI-derived field carries a tiny provenance chip: **AI** (brand-50 + sparkles)
  → **Accepted/Analyst** (green-100 + user). Brand = AI, green = human. Never
  invert. This is the product's most important visual promise — a human analyst
  always makes the final decision.
- **Restraint:** no gradients, no bright colors, no glass/blur, no decorative
  tints, no shadow layering, radii never > 12px. The one shadow is
  `shadow-card`. Motion is `transition-colors` only.
- **Type:** Inter (self-hosted, see `@font-face` in `client/src/index.css`).
  Default body/controls at `text-sm` (14px); page titles `text-xl font-semibold
  tracking-tight`. Eyebrow labels are `text-xs uppercase tracking-wide`.
- **Voice:** sentence case everywhere (acronyms keep canonical casing: SIG, ISO
  27001, GDPR, HIPAA, NIST). Calm, exact, accountable. No marketing tone, no
  emoji (the only two in the product are `⚠️` on the AI banner and `✓` in the
  "Validated" chip — don't add more).
- **A11y:** visible focus everywhere, skip-to-content link, ≥40px touch targets
  below `sm`. Changes are gated by the `ux` CI check (Playwright + axe).

When in doubt, mirror an existing page (`Dashboard.tsx`, `ReviewWorkspace.tsx`,
`Layout.tsx`) and read the full `design-system/DESIGN_SYSTEM.md`.
