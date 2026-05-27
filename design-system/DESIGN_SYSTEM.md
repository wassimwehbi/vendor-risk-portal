# Vendor Risk Portal — Design System

The internal design system for **Vendor Risk Portal**, an AI-assisted web app where security &
privacy analysts review vendor SIG questionnaires against **ISO 27001 / ISO 27002 / GDPR /
NIST** (with HIPAA flags when PHI is processed). A human analyst always makes the final risk
decision — the AI only assists.

This document is the **source of truth** for the product's visual language: tokens, components,
voice, and the design rules every new screen must follow.

> **What's committed in this repo.** Only this guide (`DESIGN_SYSTEM.md`) and the token
> reference (`colors_and_type.css`) are committed under `design-system/`. The original Claude
> Design bundle also shipped a cosmetic prototype kit — `preview/`, `ui_kits/`, `assets/`,
> `fonts.css`, and the `*.jsx` mock components referenced throughout this doc — which is **not**
> committed here, because the live codebase is the authoritative implementation. Where this doc
> points at those bundle paths, read them as descriptions of the source kit and use the live
> files instead:
> - **Tokens / theme:** `client/tailwind.config.js`
> - **Component recipes:** `client/src/index.css` (`.card`, `.btn-*`, `.input`, `.label`)
> - **Brand mark:** `client/src/components/BrandMark.tsx`
> - **Self-hosted Inter:** `client/public/fonts/` + `@font-face` in `client/src/index.css`
> - **Agent Skill:** `.claude/skills/design-system/SKILL.md`

## Source material this was built from

- **GitHub repo:** [`wassimwehbi/vendor-risk-portal`](https://github.com/wassimwehbi/vendor-risk-portal) — the live codebase. The visual system was reverse-engineered directly from `client/tailwind.config.js`, `client/src/index.css`, the components in `client/src/components/*`, the pages in `client/src/pages/*`, and the long-form design language note shipped with this project.
- All tokens, semantic classes, copy patterns and screen layouts cross-reference specific files in that repo so a reader can follow the chain back to a working implementation.

If you want to do design work on this product, **clone or open that repo alongside this folder** — the colors and components here will make more sense once you've seen them used in pages like `Dashboard.tsx`, `ReviewWorkspace.tsx` and `Layout.tsx`.

---

## Index

What's committed under `design-system/`:

```
design-system/
├── DESIGN_SYSTEM.md      ← this guide (the visual-language source of truth)
└── colors_and_type.css   ← token reference (values mirror client/tailwind.config.js)
```

The live implementation these describe lives in the app:

```
client/tailwind.config.js              ← brand scale, Inter, shadow-card
client/src/index.css                   ← @font-face + .card / .btn-* / .input / .label
client/src/components/BrandMark.tsx     ← shield + check logo
client/public/fonts/Inter-*.woff2       ← self-hosted Inter (5 files)
.claude/skills/design-system/SKILL.md   ← Agent Skill (auto-loads for UI work)
```

---

## Product context

A multi-tenant portal that automates the **preliminary** analysis of vendor SIG questionnaires:

1. Submitters upload a SIG (`.xlsx` / `.xls` / `.csv`) plus supporting evidence (SOC 2, ISO certs, policies).
2. The system extracts responses, classifies them into 18 standardized control domains, maps them to ISO 27001 / 27002 / GDPR / HIPAA references, scores each item, and generates follow-up questions.
3. AI runs via Claude (if `ANTHROPIC_API_KEY` is configured) or falls back to a deterministic rule-engine so it works fully offline.
4. **An analyst then reviews every finding, can Accept-AI or Override (risk, evidence, mapping, follow-ups), edits the overall risk + notes, and Approves.**
5. Reports export to CSV / Excel / print-PDF; every change lands in an audit log.

Roles: **Admin** (global, all tenants) · **Analyst** (analyze / override / approve in their tenant) · **Submitter** (submit + view own) · **Viewer** (read-only).

Surfaces in the live product:
- `Login` — SSO (Google, Microsoft) + email magic-link + dev fallback
- `Dashboard` — assessments list with risk / status / validation chips
- `New Assessment` — upload form (with downloadable SIG templates)
- `Review Workspace` — the analyst's main screen; control-by-control table with row-level override
- `Report` — print-friendly analyst report
- `Audit Trail` — append-only event log
- `Admin` — tenants, users, memberships, invitations

The UI kit in this design system covers the first four screens; the others are similar variations on the same primitives.

---

## CONTENT FUNDAMENTALS

The product is talking to a security / privacy analyst on the clock. Copy is **restrained, exact, accountable**.

### Tone
- **Calm and professional.** No marketing voice, no hype, no exclamation marks. The product sits next to GRC tools like OneTrust and Vanta and reads like one.
- **Accurate over friendly.** "Preliminary." "Insufficient." "Sufficient." "Misaligned." "Expired." Plain compliance vocabulary, no euphemism.
- **Accountable to the human.** Every AI-touched surface includes a variation of *"AI output is preliminary. The final vendor-risk decision is made by a human analyst — never automatically by the AI."* This is the most important sentence in the system and is repeated verbatim in the footer + a yellow banner above every findings table.

### Casing
- **Sentence case everywhere.** Page titles ("Vendor risk assessments"), buttons ("Run AI analysis", "Approve & validate", "Save notes"), labels ("Vendor name", "Questionnaire type") — never Title Case.
- **Acronyms keep their canonical casing.** `SIG`, `ISO 27001`, `GDPR`, `HIPAA`, `NIST`, `MFA`, `IAM`, `PHI`, `DSR`, `BAA`, `SSO`, `RBAC`, `BAA`.
- **Eyebrow / micro-labels are UPPERCASE** with `tracking-wide` (`PRELIMINARY OVERALL RISK`, `STATUS`, `APPLICABLE FRAMEWORKS`).
- **Status / risk pills are TitleCase** as a *value*: `Low / Medium / High / Critical`, `Sufficient / Insufficient / None / Expired / Misaligned`, `Uploaded / Extracted / Analyzed / Approved`.

### Person & voice
- **Second-person "you"** when talking to the signed-in user: *"Use your organization account to continue."*, *"Your account isn't associated with any tenant."*
- **No "we" / "our".** This is internal tooling, not a marketing site.
- **System speaks neutrally about itself** — *"AI output is preliminary"*, *"This is a restricted system"*. Not *"We've analyzed your vendor"*.

### Emoji
- **Effectively forbidden.** The codebase ships **two** emoji and only two:
  - `⚠️` on the preliminary-AI banner
  - `✓` (literal char) inside the "✓ Validated" chip
- Never add new emoji to anything. The aesthetic budget is spent.

### Vibe
Pragmatic GRC. Reads like the inside of a SOC 2 tool. Sentences are short, factual, and end with a period. Numbers are typed plainly (no rounding cuteness): *"AES-256-GCM"*, *"180 days"*, *"Max 20 files, 25 MB each"*.

### Concrete copy specimens (lift these patterns)

| Surface | Copy |
|---|---|
| Page title | "Vendor risk assessments" |
| Page subtitle | "AI-assisted preliminary analysis of SIG questionnaires against ISO 27001, ISO 27002 and GDPR." |
| Primary CTA | "Run AI analysis" · "Approve & validate" · "Upload & analyze" · "+ New Assessment" |
| Empty state | "No assessments yet · Create a new assessment to get started." |
| AI banner | "**AI output is preliminary.** Classifications, mappings, risk levels and follow-ups are AI-assisted suggestions to accelerate review. The final vendor-risk decision is made by a human analyst — never automatically by the AI." |
| Login footer | "This is a restricted system for authorized users only. All activity is monitored and recorded in the audit trail. Unauthorized access is prohibited." |
| App footer | "AI-assisted preliminary analysis · ISO 27001 · ISO 27002 · GDPR · NIST · Human analyst retains final decision authority" |
| Form helper | "Supported: PDF, Word, CSV, Excel, images. Text is extracted from documents on upload (images are stored without OCR). Max 20 files, 25 MB each." |

---

## VISUAL FOUNDATIONS

### Palette
- **Foundation: Tailwind slate.** Page bg `slate-50`, body text `slate-800`, page titles `slate-900`, muted text `slate-500`, borders `slate-200/300`, hover surfaces `slate-50/100`.
- **One accent: a muted steel blue.** Scale: `50 #f4f6f9 · 100 #e6eaf0 · 200 #ccd4e0 · 500 #5d6a82 · 600 #44546a (primary) · 700 #374459 (hover) · 900 #1f2733`. It only appears on primary buttons, focus rings, links, the "Analyzed" chip, AI-attribution chips and an "AI engine: Claude" status pill. Most screens use the accent **once or twice**, never as decoration. *(Values mirror `client/tailwind.config.js` exactly.)*
- **Semantic risk colors** use Tailwind's emerald / amber / orange / red ramps. They appear as **soft-tinted pills** (`bg-*-50` + `text-*-700` + `ring-1 ring-inset ring-*-200`), never as solid badges. Same recipe for evidence sufficiency.
- **No gradients. No bright colors. No decorative tints.** The design language note calls this out explicitly: "minimal color, accent reserved for one primary action per view."

### Type
- **Inter** at 400/500/600/700, system-ui fallback. No mono in product UI (only in evidence text-extraction previews).
- Compact, dense, label-driven. Most body and controls live at `text-sm` (14px). Page titles are `text-xl font-semibold tracking-tight slate-900`. Eyebrow labels are `text-xs uppercase tracking-wide slate-500`.
- Wordmark and headings use `tracking-tight` (-0.01em).

### Spacing
- Tailwind's spacing scale. Standard card padding `p-4` / `sm:p-5`. Container is `max-w-7xl mx-auto px-4`. Page vertical rhythm uses `space-y-5` between major sections in the review workspace.
- Dense by default (`py-1.5` ≈ 32px buttons on desktop) — bumped to **min 40px** below the `sm` breakpoint for touch.

### Backgrounds
- Page is `slate-50`. **No images, no gradients, no patterns, no textures, no full-bleed photography anywhere in the product.**
- Surfaces are flat white (`#fff`) on slate-50. The single texture is the row hover (`rgba(248,250,252,.6)` on table rows).
- Imagery: there is no product imagery. The only image-shaped thing is the user-uploaded evidence list (file rows show MIME-kind chips, never thumbnails).

### Animation
- **Almost none.** Two animations exist in the codebase: (1) the brand-600 top-border spinner, (2) CSS `transition-colors` on buttons and nav links (default duration, no custom easing). No fades, no entrances, no bouncing.
- Keep it that way. If you add motion, it must be `transition-colors` only.

### Hover states
- Buttons: `btn-primary` darkens (`brand-600 → brand-700`); `btn-secondary` adds a light fill (`white → slate-50`); `btn-ghost` adds a darker tint (`transparent → slate-100`); `btn-danger` (new — outlined red) shifts to `red-50` fill with a `red-300` border on hover.
- Table rows: light slate fill (`rgba(248,250,252,.6)`).
- Nav links: ghost-style (`hover:bg-slate-50`).
- Links: `text-brand-700` + `hover:underline`.
- **No color shifts on hover** (e.g. text doesn't change color when you hover a link — only the underline appears).

### Press / focus states
- No press-shrink, no shadow-pop.
- **Focus is visible everywhere.** Every interactive element gets `focus:ring-2 ring-brand-600/30` (buttons / nav / hamburger) or `focus:border-brand-600 focus:ring-brand-600/25` (inputs). Skip-to-content link in `Layout.tsx` is one of the first elements in the DOM.

### Borders
- `slate-200` for surface borders, `slate-300` for input borders. 1px, never 2px.
- Dividers inside tables / lists are `slate-100` (lighter than surface borders, so the surface frame still reads).
- Banners use semantic borders: yellow on amber, red on red, brand-100 on brand-50.

### Shadows
- **One shadow only.** `shadow-card = 0 1px 2px rgba(15,23,42,0.04)`. Cards, the sticky header (via border, not shadow), nothing else.
- Tooltips use a heavier `0 4px 12px rgba(15,23,42,0.12)` as a floating exception — slate-800 body, white text, rounded-md.
- **Never** layer shadows. Never use a colored shadow.

### Transparency & blur
- **No backdrop blur, no glass effects.** Surfaces are opaque white. The only translucency in the codebase is hover fills using `rgba(248,250,252,.6)` for table rows.

### Imagery vibe
- N/A — there is no imagery. If imagery is added (e.g. in a marketing page), it should be cool, calm, neutral, low-saturation. Stock photography of office/cybersecurity is OK; no warm, glowing tech-bro imagery.

### Corner radii
- Default `rounded-md` (6px) for cards, buttons, inputs, chips.
- `rounded-full` for pills, role badges, avatar slots, the validation chip and risk badges.
- `rounded` (4px) for the logo monogram square.
- `rounded-lg` (8px) for the slightly larger login logo, banners (`banner-warn`, `banner-err`).
- **Never** use radii > 12px. No oversized pill-shaped buttons.

### Card recipe
```css
.card {
  background: #fff;
  border: 1px solid var(--slate-200);
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(15,23,42,0.04);
}
```
That's it. Padding is set on each instance (`p-4` / `sm:p-5` for chrome, `p-6` for forms, `px-6 py-12` for empty states).

### Layout rules
- Sticky white top header (`border-b border-slate-200`, no shadow).
- `max-w-7xl mx-auto px-4` is the only container.
- Footer is a single compliance line, centered, `text-xs text-slate-500`.
- Mobile breakpoint: nav collapses to a hamburger panel below `lg` (1024px). Buttons grow to `min-height: 2.5rem` below `sm` (640px).
- Forms generally cap at `max-w-2xl` and center inside the container.
- Tables can overflow horizontally (`overflow-x-auto`) without breaking the surface — the review-workspace findings table uses this.

---

## ICONOGRAPHY

**Committed: [Lucide](https://lucide.dev) v0** — 24px viewBox, stroke 2, round caps & joins, `currentColor`. The codebase ships three hand-built SVGs (menu, Google, Microsoft) and these were exactly Lucide-shape, so we have formally adopted Lucide as the icon system for the design system.

A 22-icon starter set ships baked-in (no CDN dependency) at `ui_kits/vendor-risk-portal/Icon.jsx`. Render with `<Icon name="search" size={16} />`. To add more, copy the path content from [lucide.dev](https://lucide.dev) into the `LUCIDE` map.

### Bundled icons

| Group | Names |
|---|---|
| Nav / chrome | `menu`, `x`, `chevron-down`, `chevron-right`, `arrow-right` |
| State | `check`, `alert-triangle`, `info` |
| Files | `file`, `file-text`, `download`, `upload`, `copy`, `external-link` |
| Action / system | `search`, `plus`, `trash`, `settings`, `shield`, `user` |
| AI | `sparkles` (the AI provenance chip uses this) |

### Unicode glyphs still in play

These were in the original codebase and stay — they're cheaper than icons and read perfectly inline with text:

- `✓` inside the "✓ Validated" chip
- `→` on links ("Open →")
- `·` separator in subtitles and footer
- `▾ ▸` for table-row expansion (the kit's `<Icon name="chevron-down" />` replaces these, but the live codebase still uses the glyphs)

### Emoji

Still effectively forbidden. The only emoji in the entire product is `⚠️` on the AI-preliminary banner. Everywhere else use Lucide.

Copies of the three in-tree SVGs from the original codebase live in `assets/` for reference.

---

## AI ATTRIBUTION PATTERN (human-in-the-loop)

The product's most important promise — *"a human analyst always makes the final risk decision"* — is reinforced visually on every AI-derived field with a tiny **provenance chip**. Use the `<FieldAttribution analystStatus={…} />` helper in `ui_kits/vendor-risk-portal/Atoms.jsx` and it picks the right one.

| Pill | When | Visual |
|---|---|---|
| **AI** | Field still shows the AI's suggestion, no human action yet | Brand-50 background, brand-700 text + sparkles icon |
| **Accepted** | An analyst hit "Accept AI" — value is unchanged, but a human has reviewed it | Green-100 background, green-700 text + user icon |
| **Analyst** | An analyst overrode the AI's value | Green-100 background, green-700 text + user icon |

### Where to apply it

- **Review Workspace findings table:** every column gets the chip next to its value — framework mapping, AI finding text, risk pill, evidence verdict, follow-up questions. There's also a top-row provenance legend so the chip vocabulary is taught in-context.
- **Analyst Report:** every control row in the table is labelled. The header of "Recommended follow-up questions" carries an AI chip. The header of "Analyst notes" carries an Analyst chip.
- **Audit Trail:** action rows are tagged — `ai_analysis` and `items_extracted` carry AI; `finding_updated` with `analyst_status: overridden` and `assessment_approved` carry Analyst.
- **Dashboard:** the "AI engine: Claude" header pill is the lightest form of attribution (sparkles + brand pill).

### Why these visuals
- The chips are **tiny on purpose** (10px text, 1px inline ring). They're a *footnote*, not an alarm — the page should still read calmly. The big yellow banner (`PreliminaryBanner`) is the loud version; the chips are the silent everywhere-else version.
- Brand for AI, green for human — green is the codebase's existing "Analyst" role badge color, so the chip language compounds with role identity (an analyst seeing a green chip thinks *"oh, that came from someone like me"*).
- **Never** invert this (don't use red for AI or grey for human) — those carry different meanings in this product.

---

## Agent Skill

This design system is installed as a Claude Code Agent Skill at
`.claude/skills/design-system/SKILL.md`. It auto-loads for any UI work and tells the agent to
read this guide first and build from the live tokens/components listed in the note at the top.

---

## Caveats

- **Logo:** the brand mark is the shield + checkmark SVG in `client/src/components/BrandMark.tsx` (it replaced the former CSS-rendered "VR" text monogram). It's an inline SVG — there is no image-format logo file.
- **Icons:** the design system has now committed to **Lucide v0**. The live codebase has not yet adopted it — when contributing back to `wassimwehbi/vendor-risk-portal`, propose Lucide adoption and reuse `Icon.jsx` from this kit as the starting point.
- **Steel accent:** mirrors `client/tailwind.config.js` exactly — `brand-600 #44546a`, hover `#374459`. An exploratory cooler/deeper variant (`#3d4c63`) was tried during iteration and then rolled back; the system stays on the canonical codebase values.
- **Fonts:** Inter is self-hosted from `client/public/fonts/Inter-{Regular,Medium,SemiBold,Bold,Variable}.woff2`, wired in via `@font-face` in `client/src/index.css`.
- The UI kit is **cosmetic** — there's no real router, real API, or production-grade behavior. Lift components for mocks; for production-quality copies, port directly from `client/src/components/*`.
