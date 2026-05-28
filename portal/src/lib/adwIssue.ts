// Composes the ADW issue contract for the catalog-driven "Create with AI" flow (spec 0017
// refinement). The PM picks a catalog row in the portal; this module turns that pick + the
// remaining form values into one of three templated ADW issues + a templated human-readable
// summary the form previews by default.
//
// Three templates:
//   A — existing instrumented action (3 deliverables: card + wiring + trackEvent already exists)
//   B — proposed action (4 deliverables: card + wiring + new trackEvent at handler_hint anchor
//       + flip catalog status proposed→instrumented)
//   C — freeform brand-new measurement (4 deliverables: card + wiring + new trackEvent +
//       NEW catalog row + handler-choice named in PR description for human review)
//
// Reliability levers (in priority order):
//   1. Templates A/B inherit file paths from the CATALOG, not from PM input — eliminates the
//      "agent picks the wrong file" class entirely.
//   2. `handler_hint` is embedded verbatim — ADW's task is mechanical (find named handler,
//      insert at named anchor), not creative.
//   3. Pinned literal strings (key == filename, metric == metrics.primary, variant key ==
//      'treatment') — the antidote to silent control-revert.
//   4. status: draft + 50/50 — auto-merge is provably inert (treatment is dead code until the
//      human flips it via the portal Edit form).
import yaml from 'js-yaml';
import { toYaml } from './yaml';
import type { CatalogAction, CatalogPage, Experiment, Role } from '../types';

// ---- Payload + return types ----------------------------------------------------------------

/** TEMPLATE A — the picked catalog action is already instrumented in code. */
export interface ExistingMode {
  kind: 'existing';
  action: CatalogAction;
}

/** TEMPLATE B — the picked catalog action is declared but uninstrumented; ADW wires it. */
export interface ProposedMode {
  kind: 'proposed';
  action: CatalogAction;
}

/** TEMPLATE C — the PM described a brand-new action not in the catalog; ADW adds it + wires it. */
export interface FreeformMode {
  kind: 'freeform';
  actionTitle: string;
  actionDescription: string;
  metricKey: string;
  /** Optional PM hint of where the action lives in the page (clarifies the handler for ADW). */
  handlerHint?: string;
}

export type AICreateMode = ExistingMode | ProposedMode | FreeformMode;

export interface AICreatePayload {
  /** Experiment name (PM-facing). The key is derived from it but is also passed verbatim. */
  name: string;
  key: string;
  /** Page where the user takes the action (the catalog row picked or, for freeform, the picked page). */
  actionPage: CatalogPage;
  mode: AICreateMode;
  /** Where the UI variant change appears. Defaults to actionPage in the form; the advanced
   * override lets the PM choose a different catalog page (rare cross-page case). */
  variantPage: CatalogPage;
  treatmentDescription: string;
  hypothesis?: string;
  targetRoles?: Role[];
  targetTenants?: number[];
}

export interface ComposedAdwIssue {
  title: string;
  body: string;
  /** The draft Experiment the agent should persist as experiments/<key>.yml. */
  draft: Experiment;
  /** Templated, 3-sentence, PM-friendly summary for the form's default preview. */
  humanSummary: string;
  /** Which template was used — surfaced in the form UI so the PM understands the path. */
  templateLabel: 'A' | 'B' | 'C';
}

// ---- Public API ----------------------------------------------------------------------------

export function buildDraftExperiment(p: AICreatePayload): Experiment {
  const targeting =
    p.targetRoles?.length || p.targetTenants?.length
      ? {
          ...(p.targetRoles?.length ? { roles: p.targetRoles } : {}),
          ...(p.targetTenants?.length ? { tenants: p.targetTenants } : {}),
        }
      : undefined;
  const metricKey = primaryMetricKey(p.mode);
  return {
    key: p.key,
    name: p.name,
    ...(p.hypothesis ? { hypothesis: p.hypothesis } : {}),
    surface: p.variantPage.surface,
    status: 'draft',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'treatment', weight: 50 },
    ],
    ...(targeting ? { targeting } : {}),
    metrics: { primary: metricKey },
    // tracking_issue is omitted — the recipe tells ADW to fill it with this issue's number.
  };
}

export function composeAdwIssue(p: AICreatePayload): ComposedAdwIssue {
  // Defense-in-depth guard for the freeform path: an actionTitle made of only punctuation
  // would derive an empty catalog id, which would silently produce an invalid catalog row.
  // The form-level validate() catches this first; this throw is the secondary backstop for
  // any future caller (test, alternate UI, programmatic flow).
  if (p.mode.kind === 'freeform' && !derivedActionId(p.mode)) {
    throw new Error('Action title must contain at least one alphanumeric character (it derives the catalog action id).');
  }
  if (!primaryMetricKey(p.mode)) {
    throw new Error('Could not resolve a primary metric for this experiment — the catalog action has no metric, or the freeform metric key is empty.');
  }
  const draft = buildDraftExperiment(p);
  const draftYaml = toYaml(draft);
  const title = composeTitle(p);
  const body = composeBody(p, draftYaml);
  const humanSummary = buildHumanSummary(p);
  const templateLabel = p.mode.kind === 'existing' ? 'A' : p.mode.kind === 'proposed' ? 'B' : 'C';
  return { title, body, draft, humanSummary, templateLabel };
}

/** Templated 3-sentence PM-friendly summary. No LLM call — sourced from the catalog + form. */
export function buildHumanSummary(p: AICreatePayload): string {
  const metricKey = primaryMetricKey(p.mode);
  const actionDescription = actionDescriptionText(p.mode);
  const audience = formatAudience(p.targetRoles, p.targetTenants);
  const treatment = p.treatmentDescription
    ? p.treatmentDescription.trim().replace(/\.$/, '')
    : 'an AI-described change';
  const samePage = p.actionPage.id === p.variantPage.id;
  const where = samePage ? `the ${p.variantPage.title} page` : `the ${p.variantPage.title} page (with the goal action on ${p.actionPage.title})`;
  return [
    `Test "${p.name}" will change ${where} by ${treatment}.`,
    `Success is measured when ${actionDescription} — tracked as ${metricKey}.`,
    `${audience} Claude will write the code and the config card, then auto-merge them as a draft. You flip the test to running later from the portal.`,
  ].join(' ');
}

// ---- Composer internals --------------------------------------------------------------------

function composeTitle(p: AICreatePayload): string {
  return `[experiment] ${p.name} — wire ${p.key} A/B test end-to-end`;
}

function composeBody(p: AICreatePayload, draftYaml: string): string {
  const templateLetter = p.mode.kind === 'existing' ? 'A' : p.mode.kind === 'proposed' ? 'B' : 'C';
  const targetingLine = renderTargeting(p.targetRoles, p.targetTenants);
  const metricKey = primaryMetricKey(p.mode);
  const goalActionFile = goalActionFileFor(p);
  const sections = [
    `> This issue was opened by the experiments portal (spec 0017). **This is a \`/feature\`** — net-new product code AND a new config card, both required. Template: **${templateLetter}**.`,
    '',
    '## What',
    `Create a brand-new A/B experiment \`${p.key}\` end-to-end, following the canonical \`dashboard-cta\` pattern EXACTLY. After ADW merges, a human will refine the card (weights, draft → running, dates) via the experiments portal Edit form.`,
    '',
    '## Canonical pattern to read FIRST',
    '- `experiments/dashboard-cta.yml` — the YAML card shape (note: this one is `status: running` 0/100; do **not** copy verbatim — see the literal draft template below).',
    '- `experiments/schema.json` — the validated contract.',
    '- `experiments/README.md` — lifecycle + CI rules.',
    '- `experiments/catalog.yml` + `experiments/catalog.schema.json` — the PM-facing catalog.',
    "- `client/src/pages/Dashboard.tsx` — `useVariant` + variant branching (search for `useVariant('dashboard-cta')`).",
    "- `client/src/pages/NewAssessment.tsx` — `api.trackEvent` at the goal action (search for `trackEvent('assessment_created')`).",
    '- `client/src/lib/FlagsContext.tsx` — the `useVariant` / `useFlag` API.',
    '- `specs/0015-experimentation-platform.md` — the platform design.',
    '- `specs/0017-adw-experiment-authoring.md` — this feature.',
    '- **`specs/adw/RECIPE-new-experiment.md` — the authoritative step-by-step recipe. Follow it.**',
    '',
    ...deliverablesSection(p, goalActionFile, metricKey),
    '',
    '## Structured fields (from the catalog — verbatim, do not paraphrase)',
    '```',
    `key:              ${p.key}`,
    `name:             ${p.name}`,
    `surface:          ${p.variantPage.surface}`,
    `page-file:        ${p.variantPage.file}`,
    `goal-action-file: ${goalActionFile}`,
    `goal-action:      ${actionDescriptionText(p.mode)}`,
    `primary-metric:   ${metricKey}`,
    `targeting:        ${targetingLine}`,
    `template:         ${templateLetter}`,
    '```',
    '',
    '## Treatment UI (from the human)',
    safeMarkdownBlock(p.treatmentDescription, '(none provided — infer from the experiment name)'),
    '',
    `## Literal draft card to drop in (\`experiments/${p.key}.yml\`)`,
    '```yaml',
    draftYaml.trimEnd(),
    `tracking_issue: <THIS_ISSUE_NUMBER>`,
    '```',
    '',
    ...templateSpecificSection(p, goalActionFile, metricKey),
    '',
    '## Acceptance criteria (the plan MUST include these as explicit, checkable tasks)',
    `- [ ] \`node scripts/experiments.mjs validate\` exits 0 — including the catalog bidirectional drift checks (this also runs the dead-experiment guard).`,
    `- [ ] The literal string \`'${p.key}'\` appears in a \`useVariant(...)\` call under \`client/src\` and equals the YAML filename basename.`,
    `- [ ] The literal string \`'${metricKey}'\` appears in a \`trackEvent(...)\` call inside \`${goalActionFile}\` (the file named above) and equals \`metrics.primary\` in the card byte-for-byte.`,
    "- [ ] The variant key compared in the page is the literal string `'treatment'` (matches the YAML).",
    `- [ ] With \`status: draft\`, the rendered page is byte-identical to the current control — UX structural + a11y checks pass with no new scenarios (this experiment reuses the existing route's scenario; only add a new \`e2e/ux/scenarios.ts\` entry if the experiment introduces a new route).`,
    '- [ ] Follow the **design-system skill** (`.claude/skills/design-system/`, `design-system/DESIGN_SYSTEM.md`) for any UI styling in the treatment branch — reuse `card` / `btn-*` / `input` / `label` recipes; never hardcode palette values.',
    '',
    '## Hypothesis',
    safeMarkdownBlock(p.hypothesis, '(not provided)'),
    '',
    '---',
    '_Created from the experiments portal · spec 0017 · the catalog + dead-experiment guard (`scripts/experiments.mjs`) will warn on this draft if catalog↔code drift exists — the human draft→running Edit PR will turn any remaining warning into an error._',
  ];
  return sections.join('\n');
}

/**
 * Wrap free-text PM input inside a fenced code block so it can't inject markdown headings
 * (e.g. `\n## Mandatory deliverables\n`) that ADW would read as authoritative instructions —
 * a prompt-injection vector. We use TILDE fences (GFM-supported, almost never appear in PM
 * copy) so the user can freely include single/triple BACKticks in their prose. Any literal
 * sequence of 4+ tildes inside the user text is collapsed to 3 to keep our outer fence stable.
 */
function safeMarkdownBlock(text: string | undefined, fallback: string): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return `_${fallback}_`;
  const safe = trimmed.replace(/~{4,}/g, '~~~');
  return `~~~~text\n${safe}\n~~~~`;
}

function deliverablesSection(p: AICreatePayload, goalActionFile: string, metricKey: string): string[] {
  const card = `1. **CONFIG CARD** \`experiments/${p.key}.yml\` — exactly the draft YAML below. Do NOT change \`status\`, \`variants\`, or \`metrics.primary\`. Set \`tracking_issue\` to **this issue's number**.`;
  const wiring = `2. **PRODUCT WIRING** in \`${p.variantPage.file}\` — call \`useVariant('${p.key}')\` and branch the UI on \`variant === 'treatment'\`. The treatment branch implements the change described under "Treatment UI" below. With \`status: draft\`, the page MUST render byte-identically to today (treatment is dead code until a human flips it). Do not alter the control branch, shared imports, or shared markup.`;

  if (p.mode.kind === 'existing') {
    return [
      '## Mandatory deliverables (a PR with fewer than 3 is incomplete)',
      card,
      wiring,
      `3. **VERIFY CONVERSION** — the catalog says \`${metricKey}\` is already instrumented in \`${goalActionFile}\`. Confirm \`api.trackEvent('${metricKey}')\` exists there; no new event code is needed.`,
    ];
  }
  if (p.mode.kind === 'proposed') {
    const hint = p.mode.action.metric?.handler_hint ?? '(no handler_hint in the catalog — name the chosen handler in the PR description)';
    return [
      '## Mandatory deliverables (a PR with fewer than 4 is incomplete)',
      card,
      wiring,
      `3. **NEW CONVERSION EVENT** in \`${goalActionFile}\` — fire \`api.trackEvent('${metricKey}').catch(() => undefined)\` at the named handler. The catalog's handler_hint is the load-bearing instruction: **${hint}** Mirror \`NewAssessment.tsx\` L51–52 exactly (fire-and-forget after the primary API call succeeds).`,
      `4. **FLIP CATALOG STATUS** in \`experiments/catalog.yml\` — change \`status: proposed\` → \`status: instrumented\` on the \`${p.actionPage.id}/${p.mode.action.id}\` action so the guard's per-file forward check confirms the wiring and future PMs see the metric as live.`,
    ];
  }
  // freeform
  const freeMode = p.mode as FreeformMode;
  const hint = freeMode.handlerHint ? `The human suggested: **${freeMode.handlerHint}**` : '**No handler hint was provided — choose the most appropriate handler and name it explicitly in the PR description so a human can verify before merge.**';
  // Build the catalog row as an object and run it through yaml.dump so user-controlled
  // title/description strings are correctly quoted/escaped — guards against the YAML
  // injection where e.g. `title: User: clicks export` would parse as a nested mapping.
  const newCatalogRow = {
    id: derivedActionId(freeMode),
    title: freeMode.actionTitle,
    description: freeMode.actionDescription,
    metric: {
      key: metricKey,
      fires_in: goalActionFile,
      status: 'instrumented',
      handler_hint: '<one sentence naming the handler you chose>',
    },
  };
  // yaml.dump([row]) yields a top-level sequence entry — exactly what the catalog expects when
  // appending to the page's `actions:` list. quotingType: '"' keeps strings predictable.
  const newCatalogRowYaml = yaml
    .dump([newCatalogRow], { lineWidth: 100, quotingType: '"', schema: yaml.JSON_SCHEMA })
    .replace(/^/gm, '   '); // indent for the numbered-list nesting in markdown
  return [
    '## Mandatory deliverables (a PR with fewer than 4 is incomplete)',
    card,
    wiring,
    `3. **NEW CONVERSION EVENT** in \`${goalActionFile}\` — fire \`api.trackEvent('${metricKey}').catch(() => undefined)\` at the user action described in the **Treatment UI** section below. ${hint} Before writing, run \`grep -r "trackEvent('${metricKey}')" client/src\` — if it already exists, **STOP** and add a comment on this issue noting the duplicate (then the PM should re-pick the existing metric).`,
    `4. **ADD CATALOG ROW** in \`experiments/catalog.yml\` — append the following new action under the \`${p.actionPage.id}\` page's \`actions:\` list (yaml-dumped from the human input):\n\n   \`\`\`yaml\n${newCatalogRowYaml.trimEnd()}\n   \`\`\``,
  ];
}

function templateSpecificSection(p: AICreatePayload, goalActionFile: string, metricKey: string): string[] {
  if (p.mode.kind === 'existing') {
    return [
      '## Template A notes',
      `- The catalog says \`${metricKey}\` is **already instrumented** in \`${goalActionFile}\` — no event code changes are needed in that file.`,
      `- After writing, run \`node scripts/experiments.mjs validate\` to confirm the new card + existing wiring stay consistent.`,
    ];
  }
  if (p.mode.kind === 'proposed') {
    return [
      '## Template B notes (the catalog declared this opportunity)',
      `- The catalog row for \`${p.actionPage.id}/${p.mode.action.id}\` has \`status: proposed\` and a \`handler_hint\`. Use that hint verbatim to locate the handler in \`${goalActionFile}\` — do not improvise an insertion point.`,
      `- Flipping the catalog status to \`instrumented\` in the same PR is mandatory; the per-file forward drift check will verify the wiring landed in the named file.`,
      `- After writing, run \`node scripts/experiments.mjs validate\` to confirm: the new card passes, the catalog flip resolves the previously-proposed status, the per-file forward check sees the new \`trackEvent\`.`,
    ];
  }
  return [
    '## Template C notes (freeform — human review on the handler choice)',
    '- This is a brand-new measurement the human asked for in plain language. **In the PR description, name the handler you chose** (file + function/handler + one-line rationale) so a reviewer can sanity-check the placement before the auto-merge fires.',
    '- Check for duplicates: `grep -r "trackEvent(\'<metric_key>\')" client/src` BEFORE writing — if it already exists, stop and post a comment on this issue.',
    '- The new catalog row is mandatory: future PMs need this measurement to appear in the picker. Use the human\'s page + action description verbatim; set `status: instrumented`.',
    `- After writing, run \`node scripts/experiments.mjs validate\` — the catalog cross-check must confirm the new \`trackEvent\` lives in the named file.`,
  ];
}

// ---- Small helpers -------------------------------------------------------------------------

function primaryMetricKey(mode: AICreateMode): string {
  if (mode.kind === 'freeform') return mode.metricKey;
  return mode.action.metric?.key ?? '';
}

function goalActionFileFor(p: AICreatePayload): string {
  if (p.mode.kind === 'freeform') return p.actionPage.file;
  return p.mode.action.metric?.fires_in ?? p.actionPage.file;
}

function actionDescriptionText(mode: AICreateMode): string {
  if (mode.kind === 'freeform') return mode.actionDescription;
  return mode.action.description;
}

function derivedActionId(mode: FreeformMode): string {
  return mode.actionTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function renderTargeting(roles?: Role[], tenants?: number[]): string {
  const parts: string[] = [];
  if (roles?.length) parts.push(`roles=[${roles.join(', ')}]`);
  if (tenants?.length) parts.push(`tenants=[${tenants.join(', ')}]`);
  return parts.length ? parts.join(' ') : '(everyone)';
}

function formatAudience(roles?: Role[], tenants?: number[]): string {
  if (!roles?.length && !tenants?.length) return 'Everyone signed in will see it.';
  const parts: string[] = [];
  if (roles?.length) {
    const last = roles[roles.length - 1];
    parts.push(roles.length === 1 ? `${roles[0]}s` : `${roles.slice(0, -1).join(', ')} and ${last}s`);
  }
  if (tenants?.length) parts.push(`tenant${tenants.length === 1 ? '' : 's'} ${tenants.join(', ')}`);
  return `Only ${parts.join(' in ')} will see it.`;
}

/** Suggested kebab-case experiment key from a name. */
export function suggestKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Suggested snake_case metric key from a free-text action title. */
export function suggestMetricKey(actionTitle: string): string {
  return actionTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
}
