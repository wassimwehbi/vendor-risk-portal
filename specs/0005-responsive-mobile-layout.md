# Spec 0005 — Responsive / Mobile Layout

- **Status:** Implemented (2026-05-25)
- **Branch:** `feat/responsive-mobile`
- **Location:** `client/src/` — `components/Layout.tsx`, `index.css`, all 9 pages
  (`pages/*.tsx`), and two workspace components (`components/FindingRow.tsx`,
  `components/EvidencePanel.tsx`).
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md` (the SPA),
  `specs/0004-free-demo-deployment.md` (the live demo this is shown on), `README.md`
- **Builds on:** Spec 0001 (the React + Vite + Tailwind client).

## 1. Problem Statement & Objective

The portal was built desktop-first. On a phone several pages broke: the top **nav bar**
was a single non-wrapping flex row (logo + 4 nav links + tenant switcher + user identity
+ sign-out) that overflowed any narrow viewport, wide data **tables** (Dashboard, Admin,
AuditTrail, ReviewWorkspace, ReportView) forced horizontal page scroll, multi-column
**grids/forms** stayed side-by-side, and long strings (emails, invite tokens, filenames)
pushed past container edges.

Objective: make every page **flow and reflow cleanly on mobile** (≈360–414px), tablet,
and desktop — a **conservative responsive pass**, not a redesign. No change to
application logic, data flow, props, handlers, API calls, or copy; only layout/responsive
Tailwind classes, minimal structural wrappers, and the shared button touch-target rule.

## 2. Approach & Scope

- **Mobile-first Tailwind**, default breakpoints (sm=640, md=768, lg=1024). Base classes
  target mobile; `sm:`/`lg:` restore the wider layout.
- Preserve the existing design language: slate / `brand` palette, Inter, and the shared
  `card` / `btn-*` / `input` / `label` utilities.
- Recurring patterns applied: collapse multi-column grids to 1 column on mobile
  (`grid-cols-1 sm:grid-cols-2`); stack title+actions headers (`flex-col … sm:flex-row`);
  wrap wide tables in `overflow-x-auto` (scroll instead of break); reduce generous desktop
  padding on phones (`p-6` → `p-4 sm:p-6`); full-width primary buttons on mobile
  (`w-full sm:w-auto`); `break-words`/`break-all` for unbreakable strings.

## 3. Changes by Area

- **App shell — `components/Layout.tsx` (primary fix):** the header now **collapses to a
  hamburger menu below `lg`** and shows the full horizontal bar at `lg+`. Nav links, the
  tenant switcher, user identity, and Sign-out fold into a collapsible panel on
  phones/tablets. Implemented with a `variant: 'bar' | 'panel'` prop on the reused
  `PrimaryNavLinks` / `TenantSwitcher` / `UserMenu` (no logic duplication); the menu closes
  on route change and when the viewport grows past `lg`. `aria-expanded`/`aria-controls`
  on the toggle; the skip-link and `no-print` behavior are unchanged.
- **`index.css`:** added a **mobile-only** (`max-width: 639px`) `min-height: 2.5rem` on
  the button classes (`.btn` / `.btn-primary` / `.btn-secondary` / `.btn-ghost` — the
  variants are what the DOM actually carries, since Tailwind inlines `@apply btn` into
  each) so buttons are a comfortable touch target on phones without affecting desktop
  density. Per-button `min-h-[42px]` overrides were removed in favour of this single rule.
- **Dashboard / AuditTrail / Admin:** wide tables wrapped in `overflow-x-auto`; Admin user
  rows stack, and the create-tenant / invite forms stack with full-width controls on mobile.
- **ReportView:** toolbar and report header stack on mobile; export buttons wrap; **print
  output is unchanged** (`no-print` and the existing `overflow-x-auto` don't affect print).
- **ReviewWorkspace + FindingRow + EvidencePanel:** padding tightened on mobile, button
  groups wrap, the analyst-override grid stacks, long question/rationale/filename text wraps.
- **NewAssessment:** the two-column field grid stacks; action buttons go full-width
  (`flex-col-reverse` keeps the primary action on top on mobile).
- **Login / InviteAccept:** card padding reduced on mobile; long emails/tokens wrap.
- **DemoShowcase:** already responsive — no change.

## 4. Key Decisions & Rationale

- **Collapse the nav at `lg`, not `md`.** For an Admin the bar carries the logo, 4 links,
  the tenant switcher, identity, role badge and Sign-out — that needs ~960px, so `md`
  (768) would still overflow. `lg` guarantees no overflow for any role; tablets get a tidy
  hamburger.
- **Tables: horizontal scroll, not card-reflow.** Wrapping wide tables in `overflow-x-auto`
  is the conservative, low-risk fix. Reflowing dense tables into stacked cards on mobile is
  a redesign and was deliberately deferred (see §6).
- **Touch target as a mobile-only global rule** (in `index.css`) rather than per-button, so
  every `.btn` benefits and desktop density is untouched.

## 5. Verification

- **Build:** `cd client && npm run build` (`tsc --noEmit && vite build`) passes clean.
- **Diff review:** every change confirmed layout-only (whitespace-ignored `git diff`) — no
  logic/props/handler/copy changes.
- **Visual QA** on the running stack at **390×844** (and 1280 for desktop regression),
  via dev-login + a loaded demo scenario: Login, the collapsed nav + open panel, Dashboard
  (empty and with a scrolling table), Demo Showcase, ReviewWorkspace, ReportView,
  NewAssessment, and Admin all reflow with **no page-level horizontal overflow**; the
  desktop bar is intact at `lg+`. Console clean (only pre-existing React Router v7 warnings).

## 6. Known Limitations / Follow-ups

- **ReviewWorkspace control-detail table** scrolls horizontally as a unit on mobile rather
  than reflowing to a card/list layout; the expandable detail row is constrained by the
  table's intrinsic width. A true mobile reflow of that table is a follow-up redesign.
- Touch targets are bumped for `.btn`; inline badge-style controls (e.g. the role `select`
  inside a membership chip) were intentionally left at their compact size.
