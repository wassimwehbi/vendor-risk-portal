// Catalog-driven "Create with AI" form (spec 0017). Rewritten for non-technical PMs: a single
// vertical narrative — name → change → measurement → audience — with engineering knobs
// (variant page override, tenant IDs, hypothesis, raw issue body) tucked behind a single
// "Anything else?" disclosure. The measurement picker is a card-list radio group (not a
// <select>) so all available actions are scannable at a glance AND the nested-optgroup class
// of HTML5 bugs goes away forever.
//
// Design-system rules followed strictly (per design-system/DESIGN_SYSTEM.md + the
// design-system skill):
//   - Tokens via CSS vars only — zero hex / rgb literals.
//   - Recipes only: card / card-pad / btn-{primary,secondary,ghost,link} / input / select /
//     textarea / label / field / pill / chip / banner-{error,warn,ok} / row / between / stack /
//     grid-2 / caption / mono — plus three new recipes added next to them in styles.css:
//     option-card, section-block, disclosure, sr-only.
//   - One primary action per view (Launch the test); secondary = Cancel; ghost/link for
//     all toggles.
//   - Sentence case throughout; no emoji.
//   - The AI-attribution chip (brand-50 + sparkles) marks the templated summary card
//     immediately above the launch button — the trust moment.
import { useEffect, useMemo, useState } from 'react';
import { ADW_LABEL } from '../config';
import {
  composeAdwIssue,
  suggestKey,
  suggestMetricKey,
  type AICreatePayload,
  type FreeformMode,
  type ProposedMode,
} from '../lib/adwIssue';
import { createIssue } from '../lib/github';
import type { Catalog, CatalogAction, CatalogPage, Role } from '../types';
import { AiChip, Banner, Spinner } from './ui';

const ROLES: Role[] = ['Analyst', 'Submitter', 'Viewer', 'Admin'];
// An action title must contain at least one alphanumeric character so the derived
// catalog id is non-empty. The form blocks empty derivations at submit-time.
const HAS_ALPHANUM_RX = /[a-z0-9]/i;
const PROPOSE_NEW_VALUE = '__propose-new__';

interface Props {
  token: string;
  catalog: Catalog;
  existingKeys: string[];
  onCancel: () => void;
  onDone: (issueUrl: string, issueNumber: number) => void;
}

export function CreateWithAI({ token, catalog, existingKeys, onCancel, onDone }: Props) {
  // ---- Derived catalog views (one pass, four memo cells share input identity) -----------
  const experimentablePages = useMemo(() => catalog.pages.filter((p) => p.experimentable), [catalog]);
  const allActions = useMemo(() => collectActions(experimentablePages), [experimentablePages]);
  const instrumentedActions = useMemo(() => allActions.filter((a) => a.action.metric?.status === 'instrumented'), [allActions]);
  const proposedActions = useMemo(() => allActions.filter((a) => a.action.metric?.status === 'proposed'), [allActions]);
  const knownMetricKeys = useMemo(
    () => new Set(allActions.map((a) => a.action.metric?.key).filter((k): k is string => Boolean(k))),
    [allActions],
  );

  // ---- Form state ---------------------------------------------------------------------
  const [name, setName] = useState('');
  // pickerValue addresses ANY catalog action (instrumented OR proposed) by '<pageId>/<actionId>',
  // or the sentinel PROPOSE_NEW_VALUE when the PM clicked "Suggest a new measurement". The
  // existing-vs-proposed routing happens at composer-time based on the action's metric.status,
  // so the PM never sees those words.
  const [pickerValue, setPickerValue] = useState<string>(() => instrumentedActions[0]?.value ?? allActions[0]?.value ?? PROPOSE_NEW_VALUE);

  // Freeform sub-form (only used when pickerValue === PROPOSE_NEW_VALUE). The auto-derived
  // metric key is intentionally NOT a user-visible field — it falls out of the action title
  // and is shown only in the technical brief.
  const [freePageId, setFreePageId] = useState<string>(experimentablePages[0]?.id ?? '');
  const [freeTitle, setFreeTitle] = useState('');
  const [freeDesc, setFreeDesc] = useState('');
  const freeMetric = useMemo(() => suggestMetricKey(freeTitle), [freeTitle]);

  // Main fields
  const [treatmentDescription, setTreatmentDescription] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);

  // Tucked-away (advanced) fields
  const [hypothesis, setHypothesis] = useState('');
  const [tenantsCsv, setTenantsCsv] = useState('');
  const [variantOverrideId, setVariantOverrideId] = useState<string>('');
  const [showTechnicalBrief, setShowTechnicalBrief] = useState(false);

  // Submission status
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Picker open/close (combobox-style summary card). Default: closed so the form opens with the
  // chosen measurement visible as one card, not all six.
  const [pickerOpen, setPickerOpen] = useState(false);

  // ---- Derived data the PM doesn't see (composer inputs) -------------------------------
  const tenants = useMemo(
    () =>
      Array.from(
        new Set(
          tenantsCsv
            .split(',')
            .map((s) => s.trim())
            .filter((s) => /^\d+$/.test(s))
            .map((s) => parseInt(s, 10))
            .filter((n) => n > 0),
        ),
      ),
    [tenantsCsv],
  );

  const derivedKey = useMemo(() => suggestKey(name), [name]);

  const resolved = useMemo(
    () =>
      resolveSelection({
        pickerValue,
        allActions,
        experimentablePages,
        freePageId,
        freeTitle,
        freeDesc,
        freeMetric,
      }),
    [pickerValue, allActions, experimentablePages, freePageId, freeTitle, freeDesc, freeMetric],
  );

  // If the user changes the measurement (which changes resolved.actionPage), clear any stale
  // variant-page override so the cross-page funnel knob can't silently point at the OLD page.
  const resolvedPageId = resolved?.actionPage.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed on resolvedPageId
  useEffect(() => {
    setVariantOverrideId('');
  }, [resolvedPageId]);

  const payload: AICreatePayload | null = useMemo(() => {
    if (!resolved) return null;
    const variantPage = (variantOverrideId && experimentablePages.find((p) => p.id === variantOverrideId)) || resolved.actionPage;
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
  }, [resolved, variantOverrideId, experimentablePages, name, derivedKey, treatmentDescription, hypothesis, roles, tenants]);

  const composed = useMemo(() => {
    if (!payload || !payload.name || !payload.key) return null;
    try {
      return composeAdwIssue(payload);
    } catch {
      return null;
    }
  }, [payload]);

  const freeMetricDuplicate = pickerValue === PROPOSE_NEW_VALUE && freeMetric !== '' && knownMetricKeys.has(freeMetric);

  function toggleRole(r: Role) {
    setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  }

  function validate(p: AICreatePayload | null): string | null {
    if (!p) return 'Pick what you want to measure first.';
    if (!p.name) return 'Give the test a name.';
    if (!p.key) return 'The name needs at least one letter or number.';
    if (existingKeys.includes(p.key)) return `A test named "${p.key}" already exists — pick a different name.`;
    if (!p.treatmentDescription) return 'Describe what the test version should do.';
    if (p.mode.kind === 'freeform') {
      if (!p.mode.actionTitle.trim()) return 'Describe the user action you want to measure.';
      if (!HAS_ALPHANUM_RX.test(p.mode.actionTitle)) return 'The action description needs at least one letter or number.';
      if (freeMetricDuplicate) return `A measurement for "${p.mode.actionTitle}" already exists — pick it from the list above instead.`;
    }
    return null;
  }

  async function submit() {
    const err = validate(payload);
    if (err) {
      setError(err);
      return;
    }
    if (!composed) {
      setError('Could not compose the test brief — please double-check the fields above.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const issue = await createIssue(token, { title: composed.title, body: composed.body, labels: [ADW_LABEL] });
      onDone(issue.html_url, issue.number);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // ---- Render --------------------------------------------------------------------------
  return (
    <div className="stack">
      <div className="between">
        <div>
          <h2>Create with AI</h2>
          <p className="caption">
            Describe the test in plain language. Claude writes the product code AND the config card, then auto-merges them as a draft. You flip the test to running later from the dashboard.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          ← Back
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card card-pad">
        {/* ─── 1. Name ─────────────────────────────────────────────────────────────── */}
        <section className="section-block">
          <h3 className="section-title">What's the test called?</h3>
          <input
            id="ai-name"
            className="input"
            value={name}
            placeholder="Checkout urgency banner"
            aria-describedby={derivedKey ? 'ai-name-help' : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {derivedKey && (
            <p id="ai-name-help" className="caption mono" style={{ marginTop: '0.3rem' }}>
              id: {derivedKey}
            </p>
          )}
        </section>

        {/* ─── 2. Treatment ────────────────────────────────────────────────────────── */}
        <section className="section-block">
          <h3 className="section-title">What should the test version do?</h3>
          <p className="section-help">In plain language — Claude will write the code from this description.</p>
          <textarea
            id="ai-treatment"
            className="textarea"
            rows={4}
            value={treatmentDescription}
            placeholder="Show a tinted banner above the “New assessment” button, encouraging users to start now."
            onChange={(e) => setTreatmentDescription(e.target.value)}
          />
        </section>

        {/* ─── 3. Measurement ──────────────────────────────────────────────────────── */}
        <section className="section-block" aria-labelledby="ai-measure-heading">
          <h3 id="ai-measure-heading" className="section-title">
            How will you measure success?
          </h3>
          <p className="section-help">Pick the user action that counts as the goal.</p>

          {pickerValue === PROPOSE_NEW_VALUE ? (
            <ProposeNewSubForm
              pages={experimentablePages}
              pageId={freePageId}
              setPageId={setFreePageId}
              title={freeTitle}
              setTitle={setFreeTitle}
              description={freeDesc}
              setDescription={setFreeDesc}
              duplicate={freeMetricDuplicate}
              onCancel={() => {
                setPickerValue(instrumentedActions[0]?.value ?? allActions[0]?.value ?? PROPOSE_NEW_VALUE);
                setPickerOpen(true);
              }}
            />
          ) : (
            <>
              <details open={pickerOpen} onToggle={(e) => setPickerOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary className="option-card option-card-summary" aria-label="Selected measurement — click to change">
                  <SelectedSummary selected={allActions.find((a) => a.value === pickerValue) ?? null} />
                  <span className="option-card-chevron" aria-hidden="true">▾</span>
                </summary>
                <div className="option-card-panel" role="radiogroup" aria-labelledby="ai-measure-heading">
                  {orderedActions(instrumentedActions, proposedActions).map((opt) => (
                    <label key={opt.value} className="option-card">
                      <input
                        type="radio"
                        className="sr-only"
                        name="ai-measurement"
                        value={opt.value}
                        checked={pickerValue === opt.value}
                        onChange={() => {
                          setPickerValue(opt.value);
                          setPickerOpen(false);
                        }}
                      />
                      <span className="option-card-body">
                        <span className="option-card-title">{opt.action.title}</span>
                        <span className="option-card-desc">{opt.action.description}</span>
                      </span>
                      <span className={`pill ${opt.action.metric?.status === 'instrumented' ? 'pill-running' : 'pill-draft'}`} aria-hidden="true">
                        {opt.action.metric?.status === 'instrumented' ? 'Live' : 'Not live yet'}
                      </span>
                    </label>
                  ))}
                </div>
              </details>
              <div style={{ marginTop: '0.7rem' }}>
                <button type="button" className="btn-link" onClick={() => setPickerValue(PROPOSE_NEW_VALUE)}>
                  Don't see what you want? Suggest a new measurement →
                </button>
              </div>
            </>
          )}
        </section>

        {/* ─── 4. Audience ─────────────────────────────────────────────────────────── */}
        <section className="section-block">
          <fieldset style={{ border: 0, padding: 0, margin: 0, minInlineSize: 'auto' }}>
            <legend className="section-title" style={{ padding: 0 }}>
              Who sees the test version?
            </legend>
            <p className="section-help">Pick the roles that should be in the test. Leave all unchecked to include everyone signed in.</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              {ROLES.map((r) => (
                <label key={r} className="row" style={{ gap: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} /> {r}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        {/* ─── Advanced (optional, hidden by default) ──────────────────────────────── */}
        <details className="disclosure section-block">
          <summary>Anything else? (optional)</summary>
          <div className="disclosure-content stack">
            <div className="field">
              <label className="label" htmlFor="ai-hyp">
                Hypothesis
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
            <div className="field">
              <label className="label" htmlFor="ai-tenants">
                Limit to specific tenants
              </label>
              <input
                id="ai-tenants"
                className="input"
                value={tenantsCsv}
                placeholder="12, 14"
                onChange={(e) => setTenantsCsv(e.target.value)}
              />
              <p className="caption" style={{ marginTop: '0.3rem' }}>
                Comma-separated tenant IDs. Leave blank to apply across all tenants the roles above span.
              </p>
            </div>
            <div className="field">
              <label className="label" htmlFor="ai-variant-page">
                Where the change appears
              </label>
              <select
                id="ai-variant-page"
                className="select"
                value={variantOverrideId || resolved?.actionPage.id || ''}
                onChange={(e) => setVariantOverrideId(e.target.value)}
                disabled={!resolved}
              >
                {experimentablePages.map((pg) => (
                  <option key={pg.id} value={pg.id}>
                    {pg.title}
                  </option>
                ))}
              </select>
              <p className="caption" style={{ marginTop: '0.3rem' }}>
                Defaults to the same page as the measurement. Override only when the change is on a different page from the goal action.
              </p>
            </div>
            <div className="field">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowTechnicalBrief((s) => !s)}
                aria-expanded={showTechnicalBrief}
                aria-controls="ai-technical-brief"
                style={{ padding: '0.25rem 0' }}
              >
                {showTechnicalBrief ? 'Hide' : 'Show'} the technical brief Claude will read
              </button>
              {showTechnicalBrief && composed && (
                <pre
                  id="ai-technical-brief"
                  className="mono caption"
                  style={{
                    whiteSpace: 'pre-wrap',
                    maxHeight: 360,
                    overflow: 'auto',
                    padding: '0.6rem',
                    background: 'var(--slate-50)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    marginTop: '0.4rem',
                  }}
                >
                  {composed.body}
                </pre>
              )}
            </div>
          </div>
        </details>
      </div>

      {/* ─── Trust moment: templated summary right above Launch. AI provenance chip per
            design-system/DESIGN_SYSTEM.md §AI ATTRIBUTION — brand-tinted, footnote-sized. */}
      {composed && (
        <div className="card card-pad" aria-label="What you're about to launch">
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <AiChip />
            <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 'var(--weight-semibold)' }}>
              What you're about to launch
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.55, color: 'var(--fg-body)' }}>{composed.humanSummary}</p>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy && <Spinner />} Launch the test →
        </button>
      </div>
    </div>
  );
}

// ---- Selected-summary card content (rendered inside the picker <summary>) ------------------

function SelectedSummary({ selected }: { selected: ActionRef | null }) {
  if (!selected) {
    return (
      <span className="option-card-body">
        <span className="option-card-title">Pick a measurement</span>
        <span className="option-card-desc">Click to see the user actions you can use.</span>
      </span>
    );
  }
  const isLive = selected.action.metric?.status === 'instrumented';
  return (
    <>
      <span className="option-card-body">
        <span className="option-card-title">{selected.action.title}</span>
        <span className="option-card-desc">{selected.action.description}</span>
      </span>
      <span className={`pill ${isLive ? 'pill-running' : 'pill-draft'}`} aria-hidden="true">
        {isLive ? 'Live' : 'Not live yet'}
      </span>
    </>
  );
}

// ---- Sub-form (rendered only when "Suggest a new measurement" is active) ------------------

interface SubFormProps {
  pages: CatalogPage[];
  pageId: string;
  setPageId: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  duplicate: boolean;
  onCancel: () => void;
}

function ProposeNewSubForm(p: SubFormProps) {
  return (
    <div className="card card-pad" style={{ background: 'var(--slate-50)' }}>
      <div className="between" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: 'var(--text-sm)' }}>Suggest a new measurement</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={p.onCancel}>
          Cancel
        </button>
      </div>
      <Banner kind="warn">
        Claude will add the measurement to the code and the catalog. Automated checks confirm the wiring before merge, and the test ships as a draft — no users see it until you turn it on.
      </Banner>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="ai-free-page">
            Where does the user act?
          </label>
          <select id="ai-free-page" className="select" value={p.pageId} onChange={(e) => p.setPageId(e.target.value)}>
            {p.pages.map((pg) => (
              <option key={pg.id} value={pg.id}>
                {pg.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="ai-free-title">
            What does the user do?
          </label>
          <input
            id="ai-free-title"
            className="input"
            value={p.title}
            placeholder="Click the urgency banner"
            onChange={(e) => p.setTitle(e.target.value)}
          />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="ai-free-desc">
          Add a one-line description (optional)
        </label>
        <input
          id="ai-free-desc"
          className="input"
          value={p.description}
          placeholder="User clicks the new urgency banner on the dashboard."
          onChange={(e) => p.setDescription(e.target.value)}
        />
      </div>
      {p.duplicate && (
        <p className="caption" style={{ marginTop: '0.5rem', color: 'var(--amber-700)' }}>
          A measurement that matches "{p.title}" already exists — pick it from the list above instead.
        </p>
      )}
    </div>
  );
}

// ---- Pure helpers ------------------------------------------------------------------------

interface ActionRef {
  value: string; // '<pageId>/<actionId>'
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

/** Instrumented (Live) first, then proposed (Not live yet) — favors no-engineering-needed flows. */
function orderedActions(instrumented: ActionRef[], proposed: ActionRef[]): ActionRef[] {
  return [...instrumented, ...proposed];
}

interface Resolved {
  actionPage: CatalogPage;
  mode: AICreatePayload['mode'];
}

function resolveSelection(args: {
  pickerValue: string;
  allActions: ActionRef[];
  experimentablePages: CatalogPage[];
  freePageId: string;
  freeTitle: string;
  freeDesc: string;
  freeMetric: string;
}): Resolved | null {
  if (args.pickerValue !== PROPOSE_NEW_VALUE) {
    const ref = args.allActions.find((a) => a.value === args.pickerValue);
    if (!ref) return null;
    // Composer routing is purely structural: instrumented → TEMPLATE A, proposed → TEMPLATE B.
    if (ref.action.metric?.status === 'proposed') {
      const mode: ProposedMode = { kind: 'proposed', action: ref.action };
      return { actionPage: ref.page, mode };
    }
    return { actionPage: ref.page, mode: { kind: 'existing', action: ref.action } };
  }
  const page = args.experimentablePages.find((p) => p.id === args.freePageId);
  if (!page) return null;
  // The freeform description falls back to the title so the catalog row + the issue body
  // both always have a non-empty description even when the PM left the optional field blank.
  const mode: FreeformMode = {
    kind: 'freeform',
    actionTitle: args.freeTitle,
    actionDescription: args.freeDesc.trim() || args.freeTitle,
    metricKey: args.freeMetric,
  };
  return { actionPage: page, mode };
}
