// Composes the ADW issue contract for the "Create with AI" flow (spec 0017). The portal turns the
// guided form into a checklist-shaped issue body and a literal draft YAML card embedded inline —
// so the build agent never has to *invent* the card shape, only drop it in. The body is short
// enough to scan and points at specs/adw/RECIPE-new-experiment.md for the mechanical recipe.
//
// Reliability levers, in priority order:
//   1. Distinct, EXPLICIT page-file vs goal-action-file paths — eliminates the "agent picks the
//      wrong file" failure that produces wiring without a conversion event (or vice-versa).
//   2. A checklist of THREE mandatory deliverables (card + wiring + conversion) — maps cleanly
//      onto the planner's "Step by Step Tasks" template.
//   3. Pinned literal strings: key == filename, variant 'treatment', metric == metrics.primary —
//      the antidote to the silent control-revert bug (there is no typed link between YAML and code).
//   4. Status `draft`, control/treatment 50/50 — sidesteps the running-only audience-overlap scan
//      AND makes the auto-merge inert (treatment is dead code until a human flips draft→running).
import { toYaml } from './yaml';
import type { Experiment, Role } from '../types';

export interface AICreatePayload {
  key: string;
  name: string;
  /** Page file where the variant branches (`useVariant('<key>')`). Distinct from the goal-action file. */
  pageFile: string;
  /** File where the conversion fires (`api.trackEvent('<metric>')`). Often a different page. */
  goalActionFile: string;
  /** Plain-language description of the user action that should count as conversion. */
  goalAction: string;
  primaryMetric: string;
  /** Free-text description of the treatment UI — the only prompt the agent gets. */
  treatmentDescription: string;
  surface?: string;
  hypothesis?: string;
  targetRoles?: Role[];
  targetTenants?: number[];
}

export interface ComposedAdwIssue {
  title: string;
  body: string;
  /** The draft Experiment the agent should drop in — also rendered inline in the body. */
  draft: Experiment;
}

/** Compose the draft Experiment object the agent will persist as experiments/<key>.yml. */
export function buildDraftExperiment(p: AICreatePayload): Experiment {
  const targeting =
    p.targetRoles?.length || p.targetTenants?.length
      ? {
          ...(p.targetRoles?.length ? { roles: p.targetRoles } : {}),
          ...(p.targetTenants?.length ? { tenants: p.targetTenants } : {}),
        }
      : undefined;
  return {
    key: p.key,
    name: p.name,
    ...(p.hypothesis ? { hypothesis: p.hypothesis } : {}),
    ...(p.surface ? { surface: p.surface } : {}),
    status: 'draft',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'treatment', weight: 50 },
    ],
    ...(targeting ? { targeting } : {}),
    metrics: { primary: p.primaryMetric },
    // tracking_issue is intentionally omitted — the recipe tells ADW to set it to this issue's
    // number (the portal doesn't know the number until after createIssue returns).
  };
}

/** Compose the ADW issue title + body from the form payload. */
export function composeAdwIssue(p: AICreatePayload): ComposedAdwIssue {
  const draft = buildDraftExperiment(p);
  const draftYaml = toYaml(draft);
  const title = `[experiment] ${p.name} — wire ${p.key} A/B test end-to-end`;
  const targetingLine = renderTargeting(p.targetRoles, p.targetTenants);

  // Body sections — kept terse; the heavy mechanical guidance lives in the recipe file the agent
  // reads. Every section is referenced by the acceptance criteria below so the reviewer agent
  // can check each box independently.
  const body = [
    '> This issue was opened by the experiments portal (spec 0017). **This is a `/feature`** — net-new product code AND a new config card, both required.',
    '',
    '## What',
    `Create a brand-new A/B experiment \`${p.key}\` end-to-end, following the canonical \`dashboard-cta\` pattern EXACTLY. After ADW merges, a human will refine the card (weights, draft → running, dates) via the experiments portal Edit form.`,
    '',
    '## Canonical pattern to read FIRST',
    '- `experiments/dashboard-cta.yml` — the YAML card shape (note: this one is `status: running` 0/100; do **not** copy verbatim — see the literal draft template below).',
    '- `experiments/schema.json` — the validated contract.',
    '- `experiments/README.md` — lifecycle + CI rules.',
    '- `client/src/pages/Dashboard.tsx` L12–20 — `useVariant` + variant branching.',
    '- `client/src/pages/NewAssessment.tsx` L51–52 — `api.trackEvent` at the goal action.',
    '- `client/src/lib/FlagsContext.tsx` — the `useVariant` / `useFlag` API.',
    '- `specs/0015-experimentation-platform.md` — the platform design.',
    '- **`specs/adw/RECIPE-new-experiment.md` — the authoritative step-by-step recipe. Follow it.**',
    '',
    '## Mandatory deliverables (a PR with fewer than 3 is incomplete)',
    `1. **CONFIG CARD** \`experiments/${p.key}.yml\` — exactly the draft YAML below. Do NOT change \`status\`, \`variants\`, or \`metrics.primary\`. Set \`tracking_issue\` to **this issue's number**.`,
    `2. **PRODUCT WIRING** in \`${p.pageFile}\` — call \`useVariant('${p.key}')\` and branch the UI on \`variant === 'treatment'\`. The treatment branch implements the change described under "Treatment UI" below. With \`status: draft\`, the page MUST render byte-identically to today (the treatment branch is dead code until a human flips the status). Do not alter the control branch, shared imports, or shared markup.`,
    `3. **CONVERSION EVENT** in \`${p.goalActionFile}\` — at the goal action (${p.goalAction}), fire \`api.trackEvent('${p.primaryMetric}').catch(() => undefined)\`. The metric name MUST be byte-identical to \`metrics.primary\` in the card.`,
    '',
    '## Structured fields (verbatim — do not paraphrase)',
    '```',
    `key:              ${p.key}`,
    `name:             ${p.name}`,
    `surface:          ${p.surface ?? '(derive from page-file basename)'}`,
    `page-file:        ${p.pageFile}`,
    `goal-action-file: ${p.goalActionFile}`,
    `goal-action:      ${p.goalAction}`,
    `primary-metric:   ${p.primaryMetric}`,
    `targeting:        ${targetingLine}`,
    '```',
    '',
    '## Treatment UI (the only free-text input from the human)',
    p.treatmentDescription || '(none provided — infer from the experiment name)',
    '',
    '## Literal draft card to drop in (`experiments/' + p.key + '.yml`)',
    '```yaml',
    draftYaml.trimEnd(),
    `tracking_issue: <THIS_ISSUE_NUMBER>`,
    '```',
    '',
    '## Acceptance criteria (the plan MUST include these as explicit, checkable tasks)',
    `- [ ] \`node scripts/experiments.mjs validate\` exits 0 (run during build/test phase so any error gets auto-iterated — ship does NOT auto-fix \`experiments\`).`,
    `- [ ] The literal string \`'${p.key}'\` appears in a \`useVariant(...)\` call under \`client/src\` and equals the YAML filename basename.`,
    `- [ ] The literal string \`'${p.primaryMetric}'\` appears in a \`trackEvent(...)\` call under \`client/src\` and equals \`metrics.primary\` in the card.`,
    "- [ ] The variant key compared in the page is the literal string `'treatment'` (matches the YAML).",
    `- [ ] With \`status: draft\`, the rendered page is byte-identical to the current control — UX structural + a11y checks pass with no new scenarios (this experiment reuses the existing route's scenario; only add a new \`e2e/ux/scenarios.ts\` entry if the experiment introduces a new route).`,
    '- [ ] Follow the **design-system skill** (`.claude/skills/design-system/`, `design-system/DESIGN_SYSTEM.md`) for any UI styling in the treatment branch — reuse `card` / `btn-*` / `input` / `label` recipes; never hardcode palette values.',
    '',
    '## Hypothesis',
    p.hypothesis || '(not provided)',
    '',
    '---',
    '_Created from the experiments portal · spec 0017 · the dead-experiment guard (`scripts/experiments.mjs`) will warn on this draft if key↔code or metric↔code is missing — the human draft→running Edit PR will turn that warning into an error._',
  ].join('\n');

  return { title, body, draft };
}

function renderTargeting(roles?: Role[], tenants?: number[]): string {
  const parts: string[] = [];
  if (roles?.length) parts.push(`roles=[${roles.join(', ')}]`);
  if (tenants?.length) parts.push(`tenants=[${tenants.join(', ')}]`);
  return parts.length ? parts.join(' ') : '(everyone)';
}
