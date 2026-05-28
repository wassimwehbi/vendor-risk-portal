// Spec 0017 — "Create with AI" flow. A guided form (+ a free-text treatment prompt) that the
// portal composes into a checklist-shaped ADW issue and posts to GitHub with the `adw:zte` label,
// triggering the repo's plan→build→test→review→ship pipeline to wire the product code AND create
// the first draft config card. Subsequent edits go through the existing ExperimentForm (Edit).
import { useMemo, useState } from 'react';
import { ADW_LABEL } from '../config';
import { composeAdwIssue, type AICreatePayload } from '../lib/adwIssue';
import { createIssue } from '../lib/github';
import type { Role } from '../types';
import { Banner, Spinner } from './ui';

const ROLES: Role[] = ['Analyst', 'Submitter', 'Viewer', 'Admin'];
const KEY_RX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const METRIC_RX = /^[a-z][a-z0-9_]*$/i;

interface Props {
  token: string;
  pageFiles: string[];
  existingKeys: string[];
  onCancel: () => void;
  onDone: (issueUrl: string, issueNumber: number) => void;
}

export function CreateWithAI({ token, pageFiles, existingKeys, onCancel, onDone }: Props) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [pageFile, setPageFile] = useState(pageFiles[0] ?? '');
  const [goalActionFile, setGoalActionFile] = useState(pageFiles[0] ?? '');
  const [goalAction, setGoalAction] = useState('');
  const [primaryMetric, setPrimaryMetric] = useState('');
  const [surface, setSurface] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [treatmentDescription, setTreatmentDescription] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [tenantsCsv, setTenantsCsv] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tenants = useMemo(
    () =>
      Array.from(
        new Set(
          tenantsCsv
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ),
    [tenantsCsv],
  );

  // Derive a default surface from the page-file basename ("Dashboard.tsx" → "dashboard") so the
  // common case is one less field to fill — keeps the form short while still letting the user
  // override it when they want a custom surface name (e.g. for overlap-protection scoping).
  const effectiveSurface = surface.trim() || derivedSurface(pageFile);

  const payload: AICreatePayload = {
    key: key.trim(),
    name: name.trim(),
    pageFile,
    goalActionFile,
    goalAction: goalAction.trim(),
    primaryMetric: primaryMetric.trim(),
    surface: effectiveSurface,
    hypothesis: hypothesis.trim() || undefined,
    treatmentDescription: treatmentDescription.trim(),
    targetRoles: roles.length ? roles : undefined,
    targetTenants: tenants.length ? tenants : undefined,
  };

  function toggleRole(r: Role) {
    setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
  }

  function validate(): string | null {
    if (!KEY_RX.test(payload.key)) return 'Key must be kebab-case (e.g. checkout-banner).';
    if (existingKeys.includes(payload.key)) return `Key "${payload.key}" already exists — choose another or edit the existing experiment.`;
    if (!payload.name) return 'Name is required.';
    if (!payload.pageFile) return 'Page file is required.';
    if (!payload.goalActionFile) return 'Goal-action file is required.';
    if (!payload.goalAction) return 'Goal action is required (describe the user action that counts as conversion).';
    if (!METRIC_RX.test(payload.primaryMetric)) return 'Primary metric must be a snake_case identifier (e.g. assessment_created).';
    if (!payload.treatmentDescription) return 'Describe the treatment UI — this is the only prompt the AI gets.';
    return null;
  }

  const composed = useMemo(() => {
    try {
      return composeAdwIssue(payload);
    } catch {
      return null;
    }
    // The composer is pure; recompute whenever any input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    payload.key,
    payload.name,
    payload.pageFile,
    payload.goalActionFile,
    payload.goalAction,
    payload.primaryMetric,
    payload.surface,
    payload.hypothesis,
    payload.treatmentDescription,
    payload.targetRoles,
    payload.targetTenants,
  ]);

  async function submit() {
    const err = validate();
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

  return (
    <div className="stack">
      <div className="between">
        <div>
          <h2>Create with AI</h2>
          <p className="caption">
            ADW will wire the product code (key + variant branch + conversion event) AND open the first config card as a <b>draft</b> — then auto-merge. After it lands, refine the card (status, weights, dates) via Edit.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          ← Back
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card card-pad">
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="ai-key">
              Key (immutable, kebab-case)
            </label>
            <input
              id="ai-key"
              className="input mono"
              value={key}
              placeholder="checkout-banner"
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="ai-name">
              Name
            </label>
            <input id="ai-name" className="input" value={name} placeholder="Checkout urgency banner" onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="ai-page">
              Page file (where useVariant is wired)
            </label>
            <select id="ai-page" className="select mono" value={pageFile} onChange={(e) => setPageFile(e.target.value)}>
              {pageFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="ai-surface">
              Surface (optional · defaults to <code className="mono">{derivedSurface(pageFile)}</code>)
            </label>
            <input id="ai-surface" className="input" value={surface} placeholder={derivedSurface(pageFile)} onChange={(e) => setSurface(e.target.value)} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="ai-goalfile">
              Goal-action file (where trackEvent fires)
            </label>
            <select id="ai-goalfile" className="select mono" value={goalActionFile} onChange={(e) => setGoalActionFile(e.target.value)}>
              {pageFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="ai-metric">
              Primary metric (snake_case)
            </label>
            <input
              id="ai-metric"
              className="input mono"
              value={primaryMetric}
              placeholder="assessment_created"
              onChange={(e) => setPrimaryMetric(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="ai-goal">
            Goal action — the user action that counts as conversion
          </label>
          <input
            id="ai-goal"
            className="input"
            value={goalAction}
            placeholder="successful submission of the New Assessment form"
            onChange={(e) => setGoalAction(e.target.value)}
          />
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
            <label className="label" htmlFor="ai-tenants">
              Target tenant IDs (optional, comma-separated)
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
            placeholder="A more prominent urgency banner above the CTA lifts assessment creation."
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="ai-treatment">
            Treatment UI — describe the change ADW should build
          </label>
          <textarea
            id="ai-treatment"
            className="textarea"
            rows={4}
            value={treatmentDescription}
            placeholder="Show a prominent urgency banner above the “New assessment” CTA, encouraging users to start now."
            onChange={(e) => setTreatmentDescription(e.target.value)}
          />
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? 'Hide' : 'Preview'} the ADW issue
          </button>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy && <Spinner />} Launch ADW build →
            </button>
          </div>
        </div>

        {showPreview && composed && (
          <div className="field" style={{ marginTop: '1rem' }}>
            <span className="label">Issue title</span>
            <div className="mono caption">{composed.title}</div>
            <span className="label" style={{ marginTop: '0.5rem' }}>
              Issue body (what ADW reads)
            </span>
            <pre className="mono caption" style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', padding: '0.6rem', background: 'var(--slate-50, #f8fafc)' }}>
              {composed.body}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/** "client/src/pages/Dashboard.tsx" → "dashboard". Used to default the surface name. */
function derivedSurface(pageFile: string): string {
  const base = pageFile.split('/').pop() ?? '';
  return base.replace(/\.tsx?$/, '').toLowerCase();
}
