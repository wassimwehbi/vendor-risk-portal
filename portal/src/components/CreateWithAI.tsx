// Catalog-driven "Create with AI" form (spec 0017 refinement). A non-technical PM picks an
// action from the experiments catalog (or proposes a new measurement); the portal composes a
// templated ADW issue and creates it labeled `adw:zte`, triggering the repo's pipeline to wire
// the product code AND open the draft config card in a single auto-merged PR.
//
// Design-system rules followed strictly (per design-system/DESIGN_SYSTEM.md + the
// design-system skill):
//   - Tokens via CSS vars only (no hex/rgb literals).
//   - Recipes only: card / card-pad / btn-* / input / select / textarea / label / field /
//     pill / chip / banner-{error,warn,ok} / row / between / stack / grid-2 / caption / mono.
//   - One primary action per view (Launch ADW build); secondary = Cancel, ghost = toggles.
//   - Sentence case; no emoji.
//   - The AI-attribution chip (brand-50 + sparkles) appears on the preview card per the
//     design system's mandatory provenance pattern.
import { useEffect, useMemo, useState } from 'react';
import { ADW_LABEL } from '../config';
import { composeAdwIssue, suggestKey, suggestMetricKey, type AICreatePayload, type FreeformMode, type ProposedMode } from '../lib/adwIssue';
import { createIssue } from '../lib/github';
import type { Catalog, CatalogAction, CatalogPage, Role } from '../types';
import { AiChip, Banner, Spinner } from './ui';

const ROLES: Role[] = ['Analyst', 'Submitter', 'Viewer', 'Admin'];
const METRIC_RX = /^[a-z][a-z0-9_]*$/;
// Action title must contain at least one alphanumeric character so derivedActionId (kebab-cased
// from the title) yields a non-empty catalog id — otherwise the freeform catalog row is invalid.
const HAS_ALPHANUM_RX = /[a-z0-9]/i;
const PROPOSE_NEW_VALUE = '__propose-new__';

interface Props {
  token: string;
  catalog: Catalog;
  existingKeys: string[];
  onCancel: () => void;
  onDone: (issueUrl: string, issueNumber: number) => void;
}

type ProposeMode = 'pick-proposed' | 'freeform';

export function CreateWithAI({ token, catalog, existingKeys, onCancel, onDone }: Props) {
  const experimentablePages = useMemo(() => catalog.pages.filter((p) => p.experimentable), [catalog]);
  const allActions = useMemo(() => collectActions(experimentablePages), [experimentablePages]);
  const instrumentedActions = useMemo(() => allActions.filter((a) => a.action.metric?.status === 'instrumented'), [allActions]);
  const proposedActions = useMemo(() => allActions.filter((a) => a.action.metric?.status === 'proposed'), [allActions]);

  const [name, setName] = useState('');
  // The picker's value is either an instrumented "<pageId>/<actionId>" or PROPOSE_NEW_VALUE.
  const [pickerValue, setPickerValue] = useState<string>(() => instrumentedActions[0]?.value ?? PROPOSE_NEW_VALUE);

  const [proposeMode, setProposeMode] = useState<ProposeMode>(proposedActions.length ? 'pick-proposed' : 'freeform');
  const [proposedValue, setProposedValue] = useState<string>(() => proposedActions[0]?.value ?? '');

  // Freeform fields (only used when mode==='freeform')
  const [freePageId, setFreePageId] = useState<string>(experimentablePages[0]?.id ?? '');
  const [freeTitle, setFreeTitle] = useState('');
  const [freeDesc, setFreeDesc] = useState('');
  const [freeMetric, setFreeMetric] = useState('');
  const [freeMetricEdited, setFreeMetricEdited] = useState(false);
  const [freeHint, setFreeHint] = useState('');

  // Variant-page override (default to the resolved action's page).
  const [variantOverrideId, setVariantOverrideId] = useState<string>('');
  const [showVariantOverride, setShowVariantOverride] = useState(false);

  const [treatmentDescription, setTreatmentDescription] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [tenantsCsv, setTenantsCsv] = useState('');

  const [showTechnicalBrief, setShowTechnicalBrief] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tenants = useMemo(
    () =>
      Array.from(
        new Set(
          tenantsCsv
            .split(',')
            // Reject anything that isn't a pure base-10 integer: rules out '0x10', '1e3', '12.0',
            // ' 12 ' (after trim, the regex demands the whole string be digits). parseInt is then
            // safe because the regex already vetted the shape.
            .map((s) => s.trim())
            .filter((s) => /^\d+$/.test(s))
            .map((s) => parseInt(s, 10))
            .filter((n) => n > 0),
        ),
      ),
    [tenantsCsv],
  );

  const derivedKey = useMemo(() => suggestKey(name), [name]);

  // Resolve the user's selection into a concrete (actionPage, mode) pair.
  const resolved = useMemo(() => resolveSelection({
    pickerValue,
    allActions,
    instrumentedActions,
    proposedActions,
    proposedValue,
    proposeMode,
    experimentablePages,
    freePageId,
    freeTitle,
    freeDesc,
    freeMetric,
    freeHint,
  }), [pickerValue, allActions, instrumentedActions, proposedActions, proposedValue, proposeMode, experimentablePages, freePageId, freeTitle, freeDesc, freeMetric, freeHint]);

  // When the user changes the measurement (a different action / page), the previous variant-page
  // override is silently stale — we'd keep wiring useVariant in the OLD page even though the visible
  // select looks fine. Reset the override AND the panel toggle whenever the resolved action page
  // changes, so the user has to opt back into the override deliberately.
  const resolvedPageId = resolved?.actionPage.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed on resolvedPageId
  useEffect(() => {
    setVariantOverrideId('');
    setShowVariantOverride(false);
  }, [resolvedPageId]);

  // Build the payload + composed issue. Both update reactively so the preview is always live.
  const payload: AICreatePayload | null = useMemo(() => {
    if (!resolved) return null;
    const variantPage = (showVariantOverride && variantOverrideId)
      ? experimentablePages.find((p) => p.id === variantOverrideId) ?? resolved.actionPage
      : resolved.actionPage;
    return {
      name: name.trim(),
      key: derivedKey,
      actionPage: resolved.actionPage,
      mode: resolved.mode,
      variantPage,
      treatmentDescription: treatmentDescription.trim(),
      hypothesis: hypothesis.trim() || undefined,
      targetRoles: roles.length ? roles : undefined,
      targetTenants: tenants.length ? tenants : undefined,
    };
  }, [resolved, showVariantOverride, variantOverrideId, experimentablePages, name, derivedKey, treatmentDescription, hypothesis, roles, tenants]);

  const composed = useMemo(() => {
    if (!payload || !payload.name || !payload.key) return null;
    try {
      return composeAdwIssue(payload);
    } catch {
      return null;
    }
  }, [payload]);

  // Surface-level dedup for freeform metric keys (catches the obvious "you already have this" case).
  const knownMetricKeys = useMemo(() => new Set(allActions.map((a) => a.action.metric?.key).filter(Boolean) as string[]), [allActions]);
  const freeMetricDuplicate = proposeMode === 'freeform' && freeMetric !== '' && knownMetricKeys.has(freeMetric);

  function toggleRole(r: Role) {
    setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  }

  function onFreeTitleChange(value: string) {
    setFreeTitle(value);
    if (!freeMetricEdited) setFreeMetric(suggestMetricKey(value));
  }

  function validate(p: AICreatePayload | null): string | null {
    if (!p) return 'Pick what you want to measure first.';
    if (!p.name) return 'Give the test a name.';
    if (!p.key) return 'The name needs at least one letter or number.';
    if (existingKeys.includes(p.key)) return `An experiment named "${p.key}" already exists — pick a different name.`;
    if (p.mode.kind === 'freeform') {
      if (!p.mode.actionTitle.trim()) return 'Describe the user action that counts as the goal.';
      if (!HAS_ALPHANUM_RX.test(p.mode.actionTitle)) return 'The action title needs at least one letter or number (it becomes the catalog id).';
      if (!p.mode.actionDescription.trim()) return 'Add a one-sentence description of the action.';
      if (!METRIC_RX.test(p.mode.metricKey)) return 'The metric key must be snake_case (e.g. checkout_started).';
      // Block the obvious duplicate at submit-time too — the inline amber caption nudges
      // the PM; this gate prevents a wasted ADW run when they ignore the nudge.
      if (freeMetricDuplicate) return `A measurement named "${p.mode.metricKey}" already exists in the catalog — pick it from the dropdown instead.`;
    }
    if (!p.treatmentDescription) return 'Describe the change ADW should build in the treatment branch.';
    return null;
  }

  async function submit() {
    const err = validate(payload);
    if (err) {
      setError(err);
      return;
    }
    if (!composed) {
      setError('Could not compose the issue body.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const issue = await createIssue(token, {
        title: composed.title,
        body: composed.body,
        labels: [ADW_LABEL],
      });
      onDone(issue.html_url, issue.number);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const pickerSummary = describePickerSummary(resolved);

  return (
    <div className="stack">
      <div className="between">
        <div>
          <h2>Create with AI</h2>
          <p className="caption">
            Describe the test in plain language. Claude writes the product code AND the config card, then auto-merges them as a draft. You flip the test to running later from this dashboard.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          ← Back
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card card-pad">
        <div className="field">
          <label className="label" htmlFor="ai-name">
            What's this test called?
          </label>
          <input
            id="ai-name"
            className="input"
            value={name}
            placeholder="Checkout urgency banner"
            onChange={(e) => setName(e.target.value)}
          />
          {derivedKey && (
            <span className="caption mono">id: {derivedKey}</span>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="ai-action">
            What do you want to measure?
          </label>
          <select
            id="ai-action"
            className="select"
            value={pickerValue}
            onChange={(e) => setPickerValue(e.target.value)}
          >
            {instrumentedActions.length > 0 && (
              <optgroup label="Available measurements">
                {Object.entries(groupByPage(instrumentedActions)).map(([pageTitle, items]) => (
                  <optgroup key={pageTitle} label={pageTitle}>
                    {items.map((it) => (
                      <option key={it.value} value={it.value}>
                        {it.action.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </optgroup>
            )}
            <option value={PROPOSE_NEW_VALUE}>Propose a new measurement…</option>
          </select>
          {pickerSummary && (
            <div className="row" style={{ marginTop: '0.4rem' }}>
              <span className="caption">{pickerSummary.description}</span>
              <span className={`pill pill-${pickerSummary.statusPill}`}>{pickerSummary.statusLabel}</span>
            </div>
          )}
        </div>

        {pickerValue === PROPOSE_NEW_VALUE && (
          <ProposeNewSubForm
            mode={proposeMode}
            setMode={setProposeMode}
            proposedActions={proposedActions}
            proposedValue={proposedValue}
            setProposedValue={setProposedValue}
            experimentablePages={experimentablePages}
            freePageId={freePageId}
            setFreePageId={setFreePageId}
            freeTitle={freeTitle}
            onFreeTitleChange={onFreeTitleChange}
            freeDesc={freeDesc}
            setFreeDesc={setFreeDesc}
            freeMetric={freeMetric}
            setFreeMetric={(v: string) => {
              setFreeMetric(v);
              setFreeMetricEdited(true);
            }}
            freeMetricDuplicate={freeMetricDuplicate}
            freeHint={freeHint}
            setFreeHint={setFreeHint}
          />
        )}

        <div className="field">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowVariantOverride((s) => !s)}
            aria-expanded={showVariantOverride}
            aria-controls="ai-variant-override-panel"
          >
            {showVariantOverride ? 'Hide' : 'Advanced — '}where does the change appear?
          </button>
          {showVariantOverride && resolved && (
            <div id="ai-variant-override-panel" style={{ marginTop: '0.4rem' }}>
              <label className="caption" htmlFor="ai-variant-page">
                By default the UI change appears on the same page as the action ({resolved.actionPage.title}). Override only when the change is on a different page from the goal action (e.g. a Dashboard CTA whose goal is reached on New assessment).
              </label>
              <select
                id="ai-variant-page"
                className="select"
                style={{ marginTop: '0.4rem' }}
                value={variantOverrideId || resolved.actionPage.id}
                onChange={(e) => setVariantOverrideId(e.target.value)}
              >
                {experimentablePages.map((pg) => (
                  <option key={pg.id} value={pg.id}>
                    {pg.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="ai-treatment">
            Describe the change Claude should build
          </label>
          <textarea
            id="ai-treatment"
            className="textarea"
            rows={4}
            value={treatmentDescription}
            placeholder="Show a tinted banner above the “New assessment” button, encouraging users to start now."
            onChange={(e) => setTreatmentDescription(e.target.value)}
          />
        </div>

        <div className="grid-2">
          {/* fieldset+legend so screen readers announce "Who sees the test?" as the group name when
              navigating the checkboxes (axe-core's group-name rule, which the ux PR gate enforces).
              Inline-reset the browser-default fieldset chrome to match the .field recipe. */}
          <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 0.9rem 0', minInlineSize: 'auto' }}>
            <legend className="label" style={{ padding: 0 }}>Who sees the test? (none = everyone)</legend>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {ROLES.map((r) => (
                <label key={r} className="caption row" style={{ marginRight: '0.5rem' }}>
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} /> {r}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label className="label" htmlFor="ai-tenants">
              Limit to tenants (optional, comma-separated)
            </label>
            <input id="ai-tenants" className="input" value={tenantsCsv} placeholder="12, 14" onChange={(e) => setTenantsCsv(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="ai-hyp">
            Hypothesis (optional)
          </label>
          <textarea
            id="ai-hyp"
            className="textarea"
            rows={2}
            value={hypothesis}
            placeholder="A more prominent CTA lifts assessment creation."
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </div>

        {composed && (
          <div className="card card-pad" style={{ marginBottom: '0.9rem' }}>
            <div className="row" style={{ marginBottom: '0.3rem' }}>
              <span className="label" style={{ margin: 0 }}>What you're about to launch</span>
              <AiChip />
            </div>
            <p className="caption" style={{ margin: 0 }}>{composed.humanSummary}</p>
            <div style={{ marginTop: '0.6rem' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowTechnicalBrief((s) => !s)}
                aria-expanded={showTechnicalBrief}
                aria-controls="ai-technical-brief"
              >
                {showTechnicalBrief ? 'Hide' : 'Show'} the technical brief Claude will read
              </button>
              {showTechnicalBrief && (
                <pre
                  id="ai-technical-brief"
                  className="mono caption"
                  style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', padding: '0.6rem', background: 'var(--slate-50)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: '0.4rem' }}
                >
                  {composed.body}
                </pre>
              )}
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy && <Spinner />} Launch ADW build →
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Propose-new sub-form ------------------------------------------------------------------

interface ProposeNewProps {
  mode: ProposeMode;
  setMode: (m: ProposeMode) => void;
  proposedActions: ActionRef[];
  proposedValue: string;
  setProposedValue: (v: string) => void;
  experimentablePages: CatalogPage[];
  freePageId: string;
  setFreePageId: (v: string) => void;
  freeTitle: string;
  onFreeTitleChange: (v: string) => void;
  freeDesc: string;
  setFreeDesc: (v: string) => void;
  freeMetric: string;
  setFreeMetric: (v: string) => void;
  freeMetricDuplicate: boolean;
  freeHint: string;
  setFreeHint: (v: string) => void;
}

function ProposeNewSubForm(p: ProposeNewProps) {
  return (
    <div className="card card-pad" style={{ marginBottom: '0.9rem', background: 'var(--slate-50)' }}>
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <button
          type="button"
          className={`btn btn-sm ${p.mode === 'pick-proposed' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => p.setMode('pick-proposed')}
          disabled={p.proposedActions.length === 0}
          title={p.proposedActions.length === 0 ? 'No proposed measurements in the catalog yet' : ''}
        >
          Pick a proposed measurement
        </button>
        <button
          type="button"
          className={`btn btn-sm ${p.mode === 'freeform' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => p.setMode('freeform')}
        >
          Describe a brand-new measurement
        </button>
      </div>

      {p.mode === 'pick-proposed' ? (
        p.proposedActions.length === 0 ? (
          <Banner kind="warn">
            No measurements have been proposed in the catalog yet. Switch to "Describe a brand-new measurement" or ask an engineer to add a row to <span className="mono">experiments/catalog.yml</span>.
          </Banner>
        ) : (
          <>
            <Banner kind="ok">
              These measurements are already mapped to a page + handler. Claude will wire them mechanically; this adds ~5 min to the build.
            </Banner>
            <div className="field">
              <label className="label" htmlFor="ai-proposed">
                Proposed measurement
              </label>
              <select id="ai-proposed" className="select" value={p.proposedValue} onChange={(e) => p.setProposedValue(e.target.value)}>
                {Object.entries(groupByPage(p.proposedActions)).map(([pageTitle, items]) => (
                  <optgroup key={pageTitle} label={pageTitle}>
                    {items.map((it) => (
                      <option key={it.value} value={it.value}>
                        {it.action.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </>
        )
      ) : (
        <>
          <Banner kind="warn">
            Freeform proposal — Claude has to interpret where to add the measurement in code. Add a clear action description; an engineer will see the handler choice in the pull request before it merges.
          </Banner>
          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="ai-free-page">
                On which page does the user act?
              </label>
              <select id="ai-free-page" className="select" value={p.freePageId} onChange={(e) => p.setFreePageId(e.target.value)}>
                {p.experimentablePages.map((pg) => (
                  <option key={pg.id} value={pg.id}>
                    {pg.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="ai-free-metric">
                Metric key (snake_case)
              </label>
              <input
                id="ai-free-metric"
                className="input mono"
                value={p.freeMetric}
                placeholder="checkout_banner_clicked"
                onChange={(e) => p.setFreeMetric(e.target.value)}
              />
              {p.freeMetricDuplicate && (
                <span className="caption" style={{ color: 'var(--amber-700)' }}>
                  A measurement with this key already exists in the catalog. Pick it from the dropdown instead — or rename this one.
                </span>
              )}
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="ai-free-title">
              Action — what does the user do?
            </label>
            <input
              id="ai-free-title"
              className="input"
              value={p.freeTitle}
              placeholder="Click the urgency banner"
              onChange={(e) => p.onFreeTitleChange(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="ai-free-desc">
              Action description (one sentence)
            </label>
            <input
              id="ai-free-desc"
              className="input"
              value={p.freeDesc}
              placeholder="User clicks the new urgency banner on the Dashboard."
              onChange={(e) => p.setFreeDesc(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="ai-free-hint">
              Optional hint to Claude on where in the page the action lives
            </label>
            <input
              id="ai-free-hint"
              className="input"
              value={p.freeHint}
              placeholder="inside the banner's onClick, after the navigation call"
              onChange={(e) => p.setFreeHint(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ---- Pure helpers --------------------------------------------------------------------------

interface ActionRef {
  value: string; // "<pageId>/<actionId>"
  page: CatalogPage;
  action: CatalogAction;
}

function collectActions(pages: CatalogPage[]): ActionRef[] {
  const out: ActionRef[] = [];
  for (const page of pages) {
    for (const action of page.actions) {
      if (!action.metric) continue;
      out.push({ value: `${page.id}/${action.id}`, page, action });
    }
  }
  return out;
}

function groupByPage(actions: ActionRef[]): Record<string, ActionRef[]> {
  const out: Record<string, ActionRef[]> = {};
  for (const a of actions) {
    if (!out[a.page.title]) out[a.page.title] = [];
    out[a.page.title].push(a);
  }
  return out;
}

interface Resolved {
  actionPage: CatalogPage;
  mode: AICreatePayload['mode'];
}

function resolveSelection(args: {
  pickerValue: string;
  allActions: ActionRef[];
  instrumentedActions: ActionRef[];
  proposedActions: ActionRef[];
  proposedValue: string;
  proposeMode: ProposeMode;
  experimentablePages: CatalogPage[];
  freePageId: string;
  freeTitle: string;
  freeDesc: string;
  freeMetric: string;
  freeHint: string;
}): Resolved | null {
  if (args.pickerValue !== PROPOSE_NEW_VALUE) {
    const ref = args.allActions.find((a) => a.value === args.pickerValue);
    if (!ref) return null;
    return { actionPage: ref.page, mode: { kind: 'existing', action: ref.action } };
  }
  if (args.proposeMode === 'pick-proposed') {
    const ref = args.proposedActions.find((a) => a.value === args.proposedValue) ?? args.proposedActions[0];
    if (!ref) return null;
    const mode: ProposedMode = { kind: 'proposed', action: ref.action };
    return { actionPage: ref.page, mode };
  }
  const page = args.experimentablePages.find((p) => p.id === args.freePageId);
  if (!page) return null;
  const mode: FreeformMode = {
    kind: 'freeform',
    actionTitle: args.freeTitle,
    actionDescription: args.freeDesc,
    metricKey: args.freeMetric,
    handlerHint: args.freeHint || undefined,
  };
  return { actionPage: page, mode };
}

function describePickerSummary(resolved: Resolved | null): { description: string; statusLabel: string; statusPill: 'running' | 'draft' } | null {
  if (!resolved) return null;
  if (resolved.mode.kind === 'existing') {
    return { description: resolved.mode.action.description, statusLabel: 'Live', statusPill: 'running' };
  }
  if (resolved.mode.kind === 'proposed') {
    return { description: resolved.mode.action.description, statusLabel: 'Not live yet', statusPill: 'draft' };
  }
  return null; // freeform shows its own sub-form
}
