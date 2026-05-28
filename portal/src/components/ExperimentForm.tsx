import { useState } from 'react';
import { openExperimentPR } from '../lib/github';
import { toYaml } from '../lib/yaml';
import type { Experiment, ExperimentStatus, ExperimentVariant, Role } from '../types';
import { Banner, Spinner } from './ui';

const STATUSES: ExperimentStatus[] = ['draft', 'running', 'paused', 'completed'];
const ROLES: Role[] = ['Analyst', 'Submitter', 'Viewer', 'Admin'];

function blank(): Experiment {
  return {
    key: '',
    name: '',
    status: 'draft',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'treatment', weight: 50 },
    ],
  };
}

export function ExperimentForm({
  token,
  initial,
  onDone,
  onCancel,
}: {
  token: string;
  initial: Experiment | null;
  onDone: (prUrl: string) => void;
  onCancel: () => void;
}) {
  const editing = initial !== null;
  const [exp, setExp] = useState<Experiment>(initial ?? blank());
  const [roles, setRoles] = useState<Role[]>(initial?.targeting?.roles ?? []);
  const [tenantsCsv, setTenantsCsv] = useState((initial?.targeting?.tenants ?? []).join(', '));
  const [primary, setPrimary] = useState(initial?.metrics?.primary ?? '');
  const [secondaryCsv, setSecondaryCsv] = useState((initial?.metrics?.secondary ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (patch: Partial<Experiment>) => setExp((e) => ({ ...e, ...patch }));
  const setVariant = (i: number, patch: Partial<ExperimentVariant>) =>
    setExp((e) => ({ ...e, variants: e.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const addVariant = () => setExp((e) => ({ ...e, variants: [...e.variants, { key: '', weight: 0 }] }));
  const removeVariant = (i: number) => setExp((e) => ({ ...e, variants: e.variants.filter((_, j) => j !== i) }));

  const weightSum = exp.variants.reduce((s, v) => s + (Number(v.weight) || 0), 0);

  function toggleRole(r: Role) {
    setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  }

  function build(): Experiment {
    // De-duplicate: the schema requires targeting.tenants to have uniqueItems.
    const tenants = Array.from(
      new Set(
        tenantsCsv
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    );
    const secondary = secondaryCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const targeting =
      roles.length || tenants.length ? { ...(roles.length ? { roles } : {}), ...(tenants.length ? { tenants } : {}) } : undefined;
    const metrics = primary.trim() ? { primary: primary.trim(), ...(secondary.length ? { secondary } : {}) } : undefined;
    return {
      ...exp,
      key: exp.key.trim(),
      name: exp.name.trim(),
      variants: exp.variants.map((v) => ({ key: v.key.trim(), weight: Number(v.weight) })),
      targeting,
      metrics,
    };
  }

  function validate(e: Experiment): string | null {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.key)) return 'Key must be kebab-case (e.g. dashboard-cta).';
    if (!e.name) return 'Name is required.';
    if (e.variants.length < 2) return 'At least two variants are required.';
    if (e.variants.some((v) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.key))) return 'Variant keys must be kebab-case.';
    if (e.variants.some((v) => !Number.isInteger(v.weight) || v.weight < 0))
      return 'Variant weights must be whole numbers ≥ 0.';
    const sum = e.variants.reduce((acc, v) => acc + v.weight, 0); // sum from the built/normalized list
    if (sum !== 100) return `Variant weights must sum to 100 (currently ${sum}).`;
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
          built.metrics ? `- **Primary metric:** \`${built.metrics.primary}\`` : '',
        ].join('\n'),
      });
      onDone(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="between">
        <h2>{editing ? `Edit ${exp.key}` : 'New experiment'}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          ← Back
        </button>
      </div>
      {error && <Banner kind="error">{error}</Banner>}

      <div className="card card-pad">
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="f-key">
              Key (immutable, kebab-case)
            </label>
            <input
              id="f-key"
              className="input mono"
              value={exp.key}
              disabled={editing}
              placeholder="dashboard-cta"
              onChange={(e) => set({ key: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="f-name">
              Name
            </label>
            <input id="f-name" className="input" value={exp.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="f-hyp">
            Hypothesis
          </label>
          <textarea
            id="f-hyp"
            className="textarea"
            rows={2}
            value={exp.hypothesis ?? ''}
            onChange={(e) => set({ hypothesis: e.target.value })}
          />
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="f-status">
              Status
            </label>
            <select
              id="f-status"
              className="select"
              value={exp.status}
              onChange={(e) => set({ status: e.target.value as ExperimentStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-surface">
              Surface (optional)
            </label>
            <input
              id="f-surface"
              className="input"
              value={exp.surface ?? ''}
              placeholder="dashboard"
              onChange={(e) => set({ surface: e.target.value })}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="f-start">
              Start (optional)
            </label>
            <input id="f-start" type="date" className="input" value={exp.start ?? ''} onChange={(e) => set({ start: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="f-end">
              End (optional)
            </label>
            <input id="f-end" type="date" className="input" value={exp.end ?? ''} onChange={(e) => set({ end: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <span className="label">Variants (weights must sum to 100 — currently {weightSum})</span>
          {exp.variants.map((v, i) => (
            <div key={i} className="row" style={{ marginBottom: '0.4rem' }}>
              <input
                className="input mono"
                style={{ flex: 2 }}
                value={v.key}
                placeholder="variant-key"
                onChange={(e) => setVariant(i, { key: e.target.value })}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                type="number"
                min={0}
                max={100}
                value={v.weight}
                onChange={(e) => setVariant(i, { weight: Number(e.target.value) })}
              />
              {exp.variants.length > 2 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeVariant(i)}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={addVariant}>
            + variant
          </button>
        </div>

        <div className="grid-2">
          <div className="field">
            <span className="label">Target roles (none = everyone)</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {ROLES.map((r) => (
                <label key={r} className="caption row" style={{ marginRight: '0.5rem' }}>
                  <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} /> {r}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-tenants">
              Target tenant IDs (comma-separated, none = all)
            </label>
            <input id="f-tenants" className="input" value={tenantsCsv} placeholder="12, 14" onChange={(e) => setTenantsCsv(e.target.value)} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="f-primary">
              Primary metric
            </label>
            <input id="f-primary" className="input mono" value={primary} placeholder="assessment_created" onChange={(e) => setPrimary(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="f-secondary">
              Secondary metrics (comma-separated)
            </label>
            <input id="f-secondary" className="input mono" value={secondaryCsv} onChange={(e) => setSecondaryCsv(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy && <Spinner />} Open pull request
          </button>
        </div>
      </div>
    </div>
  );
}
