// Config-only experiment form (spec 0017). Used by both "+ New experiment" (create) and the
// Dashboard's Edit button. Mirrors the Create-with-AI UX caliber — sectional vertical flow,
// dropdown-style measurement picker, "Anything else?" disclosure — with the key difference
// that this form CONFIGURES experiments on top of code that is already wired. No ADW
// involvement: submit opens a config-only pull request via `openExperimentPR`.
//
// Differences from CreateWithAI:
//   - Measurement picker shows only `status: instrumented` catalog actions (proposed actions
//     aren't pickable here — their wiring doesn't exist yet, so a config-only PR can't run
//     them; that path lives in Create with AI / ADW).
//   - No AI summary card, no AI provenance chip — this isn't AI-authored.
//   - Variants + weights, status, and schedule are explicit config knobs (the whole point of
//     this flow).
//   - Backward-compat: when EDITING an experiment whose primary metric doesn't match any
//     catalog action, a synthetic "Keep the current measurement (Legacy)" option appears at
//     the top of the picker. Selecting it preserves the original surface + primary metric.
//
// Design-system follows the same recipes as CreateWithAI (tokens only, no hex/rgb literals).
import { useMemo, useState } from 'react';
import { suggestKey } from '../lib/adwIssue';
import { openExperimentPR } from '../lib/github';
import { toYaml } from '../lib/yaml';
import type {
  Catalog,
  CatalogAction,
  CatalogPage,
  Experiment,
  ExperimentStatus,
  ExperimentVariant,
  Role,
} from '../types';
import { Banner, Spinner } from './ui';

const ROLES: Role[] = ['Analyst', 'Submitter', 'Viewer', 'Admin'];
const STATUSES: ExperimentStatus[] = ['draft', 'running', 'paused', 'completed'];
const STATUS_LABEL: Record<ExperimentStatus, string> = {
  draft: 'Draft',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
};
const STATUS_HELP: Record<ExperimentStatus, string> = {
  draft: 'The config exists but no one is in the test. Safe default while you set things up.',
  running: 'Actively assigning variants. Users see different variants based on weights below.',
  paused: 'Temporarily stopped. Existing assignments stay, no new ones are made.',
  completed: 'Analysis done. Archived for record-keeping.',
};
const CUSTOM_VALUE = '__custom__';
const KEBAB_RX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const METRIC_RX = /^[a-z][a-z0-9_]*$/;

interface Props {
  token: string;
  catalog: Catalog;
  initial: Experiment | null;
  onCancel: () => void;
  onDone: (prUrl: string) => void;
}

export function ExperimentForm({ token, catalog, initial, onCancel, onDone }: Props) {
  const editing = initial !== null;

  // ---- Catalog views -------------------------------------------------------------------
  const experimentablePages = useMemo(() => catalog.pages.filter((p) => p.experimentable), [catalog]);
  const instrumentedActions = useMemo<ActionRef[]>(() => collectInstrumented(experimentablePages), [experimentablePages]);

  // ---- Top-level state -----------------------------------------------------------------
  const [name, setName] = useState(initial?.name ?? '');
  const [variants, setVariants] = useState<ExperimentVariant[]>(
    initial?.variants ?? [
      { key: 'control', weight: 50 },
      { key: 'treatment', weight: 50 },
    ],
  );
  const [status, setStatus] = useState<ExperimentStatus>(initial?.status ?? 'draft');
  const [roles, setRoles] = useState<Role[]>(initial?.targeting?.roles ?? []);
  const [tenantsCsv, setTenantsCsv] = useState((initial?.targeting?.tenants ?? []).join(', '));
  const [hypothesis, setHypothesis] = useState(initial?.hypothesis ?? '');
  const [start, setStart] = useState(initial?.start ?? '');
  const [end, setEnd] = useState(initial?.end ?? '');
  const [secondaryCsv, setSecondaryCsv] = useState((initial?.metrics?.secondary ?? []).join(', '));

  // ---- Picker state --------------------------------------------------------------------
  // Try to match the loaded experiment to a catalog action (surface + primary metric).
  const matchedCatalogAction = useMemo<ActionRef | null>(() => {
    if (!editing) return null;
    return (
      instrumentedActions.find(
        (a) => a.action.metric?.key === initial?.metrics?.primary && a.page.surface === initial?.surface,
      ) ?? null
    );
  }, [editing, initial, instrumentedActions]);

  // For legacy experiments without a catalog match, hold the original surface + primary so a
  // "Keep current" picker option can preserve them on save.
  const customLegacy = useMemo(() => {
    if (!editing || matchedCatalogAction) return null;
    if (!initial?.metrics?.primary) return null;
    return { metricKey: initial.metrics.primary, surface: initial.surface ?? '' };
  }, [editing, matchedCatalogAction, initial]);

  const [pickerValue, setPickerValue] = useState<string>(() => {
    if (matchedCatalogAction) return matchedCatalogAction.value;
    if (customLegacy) return CUSTOM_VALUE;
    return instrumentedActions[0]?.value ?? '';
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedAction = useMemo(
    () => instrumentedActions.find((a) => a.value === pickerValue) ?? null,
    [instrumentedActions, pickerValue],
  );

  // ---- Derived -------------------------------------------------------------------------
  const derivedKey = editing ? (initial?.key ?? '') : suggestKey(name);
  const weightSum = variants.reduce((s, v) => s + (Number(v.weight) || 0), 0);

  const effectivePrimary = pickerValue === CUSTOM_VALUE ? customLegacy?.metricKey ?? '' : selectedAction?.action.metric?.key ?? '';
  const effectiveSurface = pickerValue === CUSTOM_VALUE ? customLegacy?.surface ?? '' : selectedAction?.page.surface ?? '';

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
  const secondary = useMemo(
    () =>
      secondaryCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [secondaryCsv],
  );

  // ---- Submission ---------------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function setVariant(i: number, patch: Partial<ExperimentVariant>) {
    setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  }
  function addVariant() {
    setVariants((vs) => [...vs, { key: '', weight: 0 }]);
  }
  function removeVariant(i: number) {
    setVariants((vs) => vs.filter((_, j) => j !== i));
  }
  function toggleRole(r: Role) {
    setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  }

  function build(): Experiment {
    const targeting =
      roles.length || tenants.length
        ? { ...(roles.length ? { roles } : {}), ...(tenants.length ? { tenants } : {}) }
        : undefined;
    const metrics = effectivePrimary
      ? { primary: effectivePrimary, ...(secondary.length ? { secondary } : {}) }
      : undefined;
    return {
      key: derivedKey,
      name: name.trim(),
      ...(hypothesis.trim() ? { hypothesis: hypothesis.trim() } : {}),
      ...(effectiveSurface ? { surface: effectiveSurface } : {}),
      status,
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      variants: variants.map((v) => ({ key: v.key.trim(), weight: Number(v.weight) })),
      ...(targeting ? { targeting } : {}),
      ...(metrics ? { metrics } : {}),
      ...(initial?.tracking_issue ? { tracking_issue: initial.tracking_issue } : {}),
    };
  }

  function validate(e: Experiment): string | null {
    if (!KEBAB_RX.test(e.key)) return 'Give the test a name with at least one letter or number.';
    if (!e.name) return 'Give the test a name.';
    if (e.variants.length < 2) return 'A test needs at least two variants.';
    if (e.variants.some((v) => !KEBAB_RX.test(v.key))) return 'Variant names must be kebab-case (e.g. "control", "treatment-a").';
    if (e.variants.some((v) => !Number.isInteger(v.weight) || v.weight < 0)) return 'Variant weights must be whole numbers ≥ 0.';
    const sum = e.variants.reduce((s, v) => s + v.weight, 0);
    if (sum !== 100) return `Variant weights must add up to 100 (currently ${sum}).`;
    const variantKeys = e.variants.map((v) => v.key);
    if (new Set(variantKeys).size !== variantKeys.length) return 'Variant names must be unique.';
    if (e.start && e.end && e.start > e.end) return 'End date must be on or after the start date.';
    if (!e.metrics?.primary) return 'Pick a measurement.';
    if (!METRIC_RX.test(e.metrics.primary)) return 'The primary measurement key is malformed — pick a different one.';
    return null;
  }

  async function submit() {
    const built = build();
    const err = validate(built);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const url = await openExperimentPR(token, built.key, toYaml(built), {
        title: `experiment(${built.key}): ${editing ? 'update' : 'add'} — status ${built.status}`,
        body: [
          'Opened from the experiments portal.',
          '',
          `- **Status:** ${built.status}`,
          `- **Variants:** ${built.variants.map((v) => `\`${v.key}\` ${v.weight}%`).join(', ')}`,
          built.metrics ? `- **Primary measurement:** \`${built.metrics.primary}\`` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      onDone(url);
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
          <h2>{editing ? `Edit ${initial?.key}` : 'New experiment'}</h2>
          <p className="caption">
            {editing
              ? "Update the configuration. Opens a pull request — review it, then merge to apply."
              : "Configure a test on code that's already wired. Opens a pull request — review it, then merge to apply."}
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
            id="exp-name"
            className="input"
            value={name}
            placeholder="Dashboard primary CTA"
            aria-describedby="exp-name-help"
            onChange={(e) => setName(e.target.value)}
          />
          {derivedKey && (
            <p id="exp-name-help" className="caption mono" style={{ marginTop: '0.3rem' }}>
              id: {derivedKey}
              {editing && ' (locked)'}
            </p>
          )}
        </section>

        {/* ─── 2. Variants ─────────────────────────────────────────────────────────── */}
        <section className="section-block">
          <h3 className="section-title">What are the variants?</h3>
          <p className="section-help">Each user gets one variant based on its weight. Weights must add up to 100.</p>
          <div className="stack" style={{ gap: '0.5rem' }}>
            {variants.map((v, i) => (
              <div key={`variant-${i}`} className="row" style={{ gap: '0.5rem' }}>
                <input
                  className="input mono"
                  style={{ flex: 2 }}
                  value={v.key}
                  placeholder={i === 0 ? 'control' : i === 1 ? 'treatment' : `variant-${i + 1}`}
                  aria-label={`Variant ${i + 1} name`}
                  onChange={(e) => setVariant(i, { key: e.target.value })}
                />
                <input
                  className="input"
                  style={{ flex: 'none', width: '5rem' }}
                  type="number"
                  min={0}
                  max={100}
                  value={v.weight}
                  aria-label={`Variant ${i + 1} weight`}
                  onChange={(e) => setVariant(i, { weight: Number(e.target.value) })}
                />
                <span className="caption" aria-hidden="true">
                  %
                </span>
                {variants.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeVariant(i)}
                    aria-label={`Remove variant ${v.key || i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="between" style={{ marginTop: '0.7rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addVariant}>
              + Add a variant
            </button>
            <span className="caption" style={{ color: weightSum === 100 ? 'var(--emerald-700)' : 'var(--fg-muted)' }}>
              Total weight: {weightSum}
              {weightSum === 100 ? ' ✓' : ' / 100'}
            </span>
          </div>
        </section>

        {/* ─── 3. Measurement ──────────────────────────────────────────────────────── */}
        <section className="section-block" aria-labelledby="exp-measure-heading">
          <h3 id="exp-measure-heading" className="section-title">
            How will you measure success?
          </h3>
          <p className="section-help">Pick the user action that counts as the goal.</p>
          <details
            open={pickerOpen}
            onToggle={(e) => setPickerOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary
              className="option-card option-card-summary"
              aria-label="Selected measurement — click to change"
            >
              <SelectedSummary
                selected={selectedAction}
                pickerValue={pickerValue}
                customLegacy={customLegacy}
              />
              <span className="option-card-chevron" aria-hidden="true">
                ▾
              </span>
            </summary>
            <div className="option-card-panel" role="radiogroup" aria-labelledby="exp-measure-heading">
              {customLegacy && (
                <label className="option-card">
                  <input
                    type="radio"
                    className="sr-only"
                    name="exp-measurement"
                    value={CUSTOM_VALUE}
                    checked={pickerValue === CUSTOM_VALUE}
                    onChange={() => {
                      setPickerValue(CUSTOM_VALUE);
                      setPickerOpen(false);
                    }}
                  />
                  <span className="option-card-body">
                    <span className="option-card-title">Keep the current measurement</span>
                    <span className="option-card-desc">
                      <span className="mono">{customLegacy.metricKey}</span> — not in the catalog
                    </span>
                  </span>
                  <span className="pill pill-paused" aria-hidden="true">
                    Legacy
                  </span>
                </label>
              )}
              {instrumentedActions.map((opt) => (
                <label key={opt.value} className="option-card">
                  <input
                    type="radio"
                    className="sr-only"
                    name="exp-measurement"
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
                  <span className="pill pill-running" aria-hidden="true">
                    Live
                  </span>
                </label>
              ))}
              {instrumentedActions.length === 0 && !customLegacy && (
                <Banner kind="warn">
                  The catalog doesn't have any live measurements yet. Use "Create with AI" to add one — it wires the
                  code AND the catalog row in one step.
                </Banner>
              )}
            </div>
          </details>
        </section>

        {/* ─── 4. Audience ─────────────────────────────────────────────────────────── */}
        <section className="section-block">
          <fieldset style={{ border: 0, padding: 0, margin: 0, minInlineSize: 'auto' }}>
            <legend className="section-title" style={{ padding: 0 }}>
              Who sees the test?
            </legend>
            <p className="section-help">
              Pick the roles that should be in the test. Leave all unchecked to include everyone signed in.
            </p>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              {ROLES.map((r) => (
                <label key={r} className="row" style={{ gap: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} /> {r}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        {/* ─── 5. Status ───────────────────────────────────────────────────────────── */}
        <section className="section-block">
          <h3 className="section-title">When does it run?</h3>
          <select
            id="exp-status"
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as ExperimentStatus)}
            aria-describedby="exp-status-help"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <p id="exp-status-help" className="caption" style={{ marginTop: '0.3rem' }}>
            {STATUS_HELP[status]}
          </p>
        </section>

        {/* ─── 6. Anything else? ───────────────────────────────────────────────────── */}
        <details className="disclosure section-block">
          <summary>Anything else? (optional)</summary>
          <div className="disclosure-content stack">
            <div className="field">
              <label className="label" htmlFor="exp-hyp">
                Hypothesis
              </label>
              <textarea
                id="exp-hyp"
                className="textarea"
                rows={2}
                value={hypothesis}
                placeholder="A more prominent CTA lifts assessment creation."
                onChange={(e) => setHypothesis(e.target.value)}
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="label" htmlFor="exp-start">
                  Start date
                </label>
                <input
                  id="exp-start"
                  type="date"
                  className="input"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="exp-end">
                  End date
                </label>
                <input
                  id="exp-end"
                  type="date"
                  className="input"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="exp-tenants">
                Limit to specific tenants
              </label>
              <input
                id="exp-tenants"
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
              <label className="label" htmlFor="exp-secondary">
                Secondary measurements
              </label>
              <input
                id="exp-secondary"
                className="input mono"
                value={secondaryCsv}
                placeholder="analyze_clicked, report_exported"
                onChange={(e) => setSecondaryCsv(e.target.value)}
              />
              <p className="caption" style={{ marginTop: '0.3rem' }}>
                Comma-separated metric keys to track alongside the primary measurement.
              </p>
            </div>
          </div>
        </details>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy && <Spinner />} Open pull request →
        </button>
      </div>
    </div>
  );
}

// ---- Helpers ------------------------------------------------------------------------------

interface ActionRef {
  value: string; // '<pageId>/<actionId>'
  page: CatalogPage;
  action: CatalogAction;
}

function collectInstrumented(pages: CatalogPage[]): ActionRef[] {
  const out: ActionRef[] = [];
  for (const page of pages) {
    for (const action of page.actions) {
      if (action.metric?.status !== 'instrumented') continue;
      out.push({ value: `${page.id}/${action.id}`, page, action });
    }
  }
  return out;
}

function SelectedSummary({
  selected,
  pickerValue,
  customLegacy,
}: {
  selected: ActionRef | null;
  pickerValue: string;
  customLegacy: { metricKey: string; surface: string } | null;
}) {
  if (pickerValue === CUSTOM_VALUE && customLegacy) {
    return (
      <>
        <span className="option-card-body">
          <span className="option-card-title">Keep the current measurement</span>
          <span className="option-card-desc">
            <span className="mono">{customLegacy.metricKey}</span> — not in the catalog
          </span>
        </span>
        <span className="pill pill-paused" aria-hidden="true">
          Legacy
        </span>
      </>
    );
  }
  if (!selected) {
    return (
      <span className="option-card-body">
        <span className="option-card-title">Pick a measurement</span>
        <span className="option-card-desc">Click to see the user actions you can use.</span>
      </span>
    );
  }
  return (
    <>
      <span className="option-card-body">
        <span className="option-card-title">{selected.action.title}</span>
        <span className="option-card-desc">{selected.action.description}</span>
      </span>
      <span className="pill pill-running" aria-hidden="true">
        Live
      </span>
    </>
  );
}
