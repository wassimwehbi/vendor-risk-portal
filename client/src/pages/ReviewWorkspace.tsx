import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AssessmentDetail, Finding, RiskLevel } from '../types';
import { DATA_CATEGORY_LABELS } from '../types';
import { RiskBadge } from '../components/RiskBadge';
import { StatusChip, ValidationChip } from '../components/StatusChip';
import { PreliminaryBanner } from '../components/PreliminaryBanner';
import { FindingRow } from '../components/FindingRow';
import { EvidencePanel } from '../components/EvidencePanel';
import { DataCategoryChips, EmptyState, ErrorNote, FrameworkChips, PageHeader, Spinner } from '../components/ui';
import { formatDay } from '../lib/format';
import { useAuth } from '../lib/AuthContext';

const RISK_OPTIONS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];

export function ReviewWorkspace() {
  const { id } = useParams();
  const assessmentId = Number(id);
  const { canEdit, canApprove, isSubmitterScope } = useAuth();

  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [approving, setApproving] = useState(false);

  const load = useCallback(() => {
    api
      .getAssessment(assessmentId)
      .then((d) => {
        setDetail(d);
        setNotes(d.assessment.analyst_notes ?? '');
      })
      .catch((e) => setError(e.message));
  }, [assessmentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function analyze() {
    setAnalyzing(true);
    setError('');
    try {
      await api.analyze(assessmentId);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  function onFindingChange(updated: Finding) {
    setDetail((d) => (d ? { ...d, findings: d.findings.map((f) => (f.id === updated.id ? updated : f)) } : d));
  }

  async function setOverallRisk(level: RiskLevel) {
    const updated = await api.patchAssessment(assessmentId, { overall_risk: level });
    setDetail((d) => (d ? { ...d, assessment: updated } : d));
  }

  async function saveNotes() {
    setSavingNotes(true);
    try {
      const updated = await api.patchAssessment(assessmentId, { analyst_notes: notes });
      setDetail((d) => (d ? { ...d, assessment: updated } : d));
    } finally {
      setSavingNotes(false);
    }
  }

  async function approve() {
    setApproving(true);
    setError('');
    try {
      const updated = await api.patchAssessment(assessmentId, { validation_status: 'approved', analyst_notes: notes });
      setDetail((d) => (d ? { ...d, assessment: updated } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApproving(false);
    }
  }

  if (error && !detail) {
    return (
      <EmptyState title="Assessment unavailable">
        It may not exist, or you don’t have access to it.{' '}
        <Link to="/" className="font-medium text-brand-700 hover:underline">Back to dashboard</Link>
      </EmptyState>
    );
  }
  if (!detail) return <div className="card px-6 py-12"><Spinner /></div>;

  const { assessment, items, findings, evidence } = detail;
  const findingsByItem = new Map(findings.map((f) => [f.item_id, f]));
  const analyzed = findings.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={assessment.vendor_name}
        subtitle={`${assessment.questionnaire_type} · submitted ${formatDay(assessment.date_submitted)}`}
        actions={
          <>
            {!isSubmitterScope && <Link to={`/assessments/${assessmentId}/audit`} className="btn-ghost">Audit trail</Link>}
            {analyzed && <Link to={`/assessments/${assessmentId}/report`} className="btn-secondary">View report</Link>}
            {canEdit && (
              <button className="btn-primary" onClick={analyze} disabled={analyzing || items.length === 0}>
                {analyzing ? 'Analyzing…' : analyzed ? 'Re-run AI analysis' : 'Run AI analysis'}
              </button>
            )}
          </>
        }
      />

      {error && <ErrorNote message={error} />}

      {/* Summary header */}
      <div className="card grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
        <div>
          <p id="overall-risk-label" className="text-xs uppercase tracking-wide text-slate-500">Preliminary overall risk</p>
          <div className="mt-1 flex items-center gap-2">
            <RiskBadge level={assessment.overall_risk} size="lg" />
            {canEdit && analyzed && (
              <select
                aria-labelledby="overall-risk-label"
                aria-label="Override overall risk"
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                value={assessment.overall_risk ?? ''}
                onChange={(e) => setOverallRisk(e.target.value as RiskLevel)}
              >
                {RISK_OPTIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <div className="mt-1 flex items-center gap-2">
            <StatusChip status={assessment.status} />
            <ValidationChip status={assessment.validation_status} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Data processed</p>
          <div className="mt-1">
            <DataCategoryChips categories={assessment.data_categories} labels={DATA_CATEGORY_LABELS} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Applicable frameworks</p>
          <div className="mt-1">
            <FrameworkChips frameworks={assessment.applicable_frameworks.length ? assessment.applicable_frameworks : ['ISO 27001', 'ISO 27002']} />
          </div>
        </div>
      </div>

      <EvidencePanel evidence={evidence} />

      {analyzed && <PreliminaryBanner />}

      {/* Control-by-control table */}
      {!analyzed ? (
        <div className="card px-4 py-8 text-center sm:px-6 sm:py-10">
          <p className="text-slate-600">{items.length} questionnaire items extracted.</p>
          <p className="mt-1 text-sm text-slate-500">Run AI analysis to classify controls, map frameworks, score risk and generate follow-ups.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <caption className="sr-only">Control-by-control AI analysis with analyst review actions</caption>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-3 font-medium">Control area</th>
                <th scope="col" className="px-3 py-3 font-medium">Vendor response</th>
                <th scope="col" className="px-3 py-3 font-medium">Framework mapping</th>
                <th scope="col" className="px-3 py-3 font-medium">AI finding</th>
                <th scope="col" className="px-3 py-3 font-medium">Evidence</th>
                <th scope="col" className="px-3 py-3 font-medium">Risk</th>
                <th scope="col" className="px-3 py-3 font-medium">Analyst</th>
                <th scope="col" className="px-3 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const f = findingsByItem.get(item.id);
                if (!f) return null;
                return <FindingRow key={item.id} item={item} finding={f} canEdit={canEdit} onChange={onFindingChange} />;
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Analyst notes + approval (analysts/admins only; submitters & viewers see a read-only outcome) */}
      {analyzed && canEdit && (
        <div className="card space-y-3 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-slate-800">Analyst decision</h3>
          <label htmlFor="analyst-notes" className="label">Analyst notes</label>
          <textarea
            id="analyst-notes"
            className="input h-24"
            placeholder="Add business context, rationale, and your recommendation…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canEdit}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              {assessment.validation_status === 'approved' ? (
                <span className="text-green-700">Validated by {assessment.validated_by}.</span>
              ) : (
                'The final risk decision must be made by a human analyst.'
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <button className="btn-secondary" onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? 'Saving…' : 'Save notes'}
                </button>
              )}
              {canApprove && assessment.validation_status !== 'approved' && (
                <button className="btn-primary" onClick={approve} disabled={approving}>
                  {approving ? 'Approving…' : 'Approve & validate'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
