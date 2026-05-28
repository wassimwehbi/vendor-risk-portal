// Declarative UX scenario manifest — the "whole scope" of the portal's UX surface.
//
// The runner (ux.spec.ts) iterates SCENARIOS × viewports and asserts deterministic,
// cross-platform-stable invariants (no horizontal overflow, axe a11y, no console errors,
// focus rings, print-mode). Adding a scenario here is the ONLY thing needed to extend
// coverage — no new test code. See specs/0012-ux-tasks-harness.md.
//
// Pixel visual snapshots (toHaveScreenshot) are opt-in per scenario via `snapshot: true`
// and only run when UX_VISUAL=1 (the nightly job), never on the blocking PR check.

export type ViewportName = 'mobile' | 'tablet' | 'desktop';

/** Breakpoints chosen to exercise the mobile-first layout (spec 0005): a phone, a tablet,
 *  and a desktop. 375px is where the date-input overflow bugs (#18/#23) reproduced. */
export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 900 },
};

/** Dev sign-in roles (the local "Developer sign-in" form's role <select> options). */
export type Role = 'Admin' | 'Analyst' | 'Submitter' | 'Viewer';

/** A declarative step the runner knows how to execute. Kept intentionally small — UX
 *  invariants don't need deep interaction, just enough to reach + render each surface. */
export type Step =
  // Navigate to a route directly.
  | { kind: 'goto'; path: string }
  // Reuse the proven showcase flow (smoke.spec.ts): /showcase → click the Nth
  // "Load & Analyze" → wait for /assessments/:id. The runner remembers the id so a
  // following `gotoAssessmentSub` can target the sub-pages without hardcoding an id.
  | { kind: 'loadScenario'; index?: number }
  // Navigate to a sub-page of the assessment loaded by a prior `loadScenario`.
  | { kind: 'gotoAssessmentSub'; sub: 'report' | 'audit' }
  // Click a control by accessible role + name.
  | { kind: 'click'; role: 'button' | 'link'; name: string }
  // Assert text is visible — a cheap "the SPA actually rendered this surface" sync point.
  | { kind: 'expectVisibleText'; text: string | RegExp };

export type Invariant =
  | 'noHorizontalOverflow' // page-level scrollWidth ≤ innerWidth + ε at the viewport
  | 'axeClean' // no serious/critical WCAG2A/AA violations
  | 'noConsoleErrors' // no console.error / pageerror during the flow
  | 'focusVisibleRing' // first focusable control shows a visible focus ring
  | 'printNoToolbar'; // in print media, no .no-print element is visible

export interface UxScenario {
  /** Stable id — used in the test title and the screenshot filename. */
  id: string;
  title: string;
  /** Dev sign-in role. Ignored when `public` is true. */
  role: Role;
  /** When true the runner does NOT sign in (pre-auth surfaces like /login). */
  public?: boolean;
  viewports: ViewportName[];
  steps: Step[];
  invariants: Invariant[];
  /** Opt-in pixel snapshot at the end of the flow (nightly-only, gated by UX_VISUAL=1). */
  snapshot?: boolean;
}

const ALL: ViewportName[] = ['mobile', 'tablet', 'desktop'];

/**
 * ~10 seed scenarios covering all 9 routes (App.tsx): /login, /, /showcase,
 * /assessments/new, /assessments/:id, /assessments/:id/report, /assessments/:id/audit,
 * /admin. /invite is token-dependent offline and deferred (see spec 0012 §limitations).
 */
export const SCENARIOS: UxScenario[] = [
  {
    id: 'login',
    title: 'Sign-in page',
    role: 'Analyst',
    public: true,
    viewports: ALL,
    steps: [
      { kind: 'goto', path: '/login' },
      { kind: 'expectVisibleText', text: 'Sign in' },
    ],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors', 'focusVisibleRing'],
    snapshot: true,
  },
  {
    id: 'dashboard',
    title: 'Dashboard / assessment list',
    role: 'Analyst',
    viewports: ALL,
    steps: [
      { kind: 'goto', path: '/' },
      { kind: 'expectVisibleText', text: 'Vendor risk assessments' },
    ],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors'],
    snapshot: true,
  },
  {
    id: 'showcase',
    title: 'Demo showcase',
    role: 'Analyst',
    viewports: ALL,
    steps: [{ kind: 'goto', path: '/showcase' }],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors'],
    snapshot: true,
  },
  {
    id: 'new-assessment',
    title: 'New assessment form (guards date-input overflow #18/#23)',
    role: 'Analyst',
    // 375px guards the width-driven half of the #18/#23 date-input overflow (the
    // text-align + @media (max-width) rules). NOTE: the `@media (pointer: coarse)` half
    // is NOT exercised — setViewportSize resizes but doesn't emulate touch, and the
    // project is Desktop Chrome (fine pointer). A touch-emulated mobile project is a
    // tracked follow-up (spec 0012 §limitations).
    viewports: ['mobile', 'desktop'],
    steps: [{ kind: 'goto', path: '/assessments/new' }],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors', 'focusVisibleRing'],
    snapshot: true,
  },
  {
    id: 'new-assessment-file-formats',
    title: 'New assessment form — questionnaire label lists .docx and .pdf (#44)',
    role: 'Analyst',
    viewports: ALL,
    steps: [
      { kind: 'goto', path: '/assessments/new' },
      { kind: 'expectVisibleText', text: 'SIG questionnaire (.xlsx, .xls, .csv, .docx, .pdf)' },
    ],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors', 'focusVisibleRing'],
  },
  {
    id: 'review',
    title: 'Review workspace (analyzed assessment)',
    role: 'Analyst',
    viewports: ALL,
    steps: [
      { kind: 'loadScenario', index: 0 },
      { kind: 'expectVisibleText', text: /\b(Low|Medium|High|Critical)\b/ },
    ],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors'],
    snapshot: true,
  },
  {
    id: 'review-alt',
    title: 'Review workspace (alternate scenario, varied content length)',
    role: 'Analyst',
    viewports: ['mobile', 'desktop'],
    steps: [{ kind: 'loadScenario', index: 3 }],
    invariants: ['noHorizontalOverflow', 'axeClean'],
  },
  {
    id: 'report',
    title: 'Report view',
    role: 'Analyst',
    viewports: ALL,
    steps: [
      { kind: 'loadScenario', index: 0 },
      { kind: 'gotoAssessmentSub', sub: 'report' },
      { kind: 'expectVisibleText', text: 'Export GRC JSON' },
    ],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors'],
    snapshot: true,
  },
  {
    id: 'report-print',
    title: 'Report view — print layout hides chrome',
    role: 'Analyst',
    viewports: ['desktop'],
    steps: [
      { kind: 'loadScenario', index: 0 },
      { kind: 'gotoAssessmentSub', sub: 'report' },
    ],
    invariants: ['printNoToolbar', 'noHorizontalOverflow'],
  },
  {
    id: 'audit',
    title: 'Audit trail',
    role: 'Analyst',
    viewports: ALL,
    steps: [
      { kind: 'loadScenario', index: 0 },
      { kind: 'gotoAssessmentSub', sub: 'audit' },
    ],
    invariants: ['noHorizontalOverflow', 'axeClean'],
  },
  {
    id: 'admin',
    title: 'Admin control plane',
    role: 'Admin',
    viewports: ALL,
    steps: [{ kind: 'goto', path: '/admin' }],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors'],
    snapshot: true,
  },
  {
    id: 'evidence-panel-vision',
    title: 'Evidence panel — AI-described image provenance chip (#45)',
    role: 'Analyst',
    viewports: ALL,
    steps: [
      { kind: 'loadScenario', index: 0 },
      { kind: 'expectVisibleText', text: 'Evidence files' },
      { kind: 'expectVisibleText', text: 'AI described' },
    ],
    invariants: ['noHorizontalOverflow', 'axeClean', 'noConsoleErrors'],
  },
];
