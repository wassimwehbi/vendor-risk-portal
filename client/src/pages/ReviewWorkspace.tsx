import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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

const STORAGE_KEY = 'vrp-grid-col-widths-v1';
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  control: 160,
  response: 220,
  framework: 160,
  finding: 200,
  evidence: 100,
  risk: 80,
  analyst: 90,
  actions: 80,
};

function useResizableColumns() {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(stored) };
    } catch {
      // ignore parse errors
    }
    return { ...DEFAULT_COL_WIDTHS };
  });

  const widthsRef = useRef(widths);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  }, [widths]);

  const updateWidth = useCallback((key: string, delta: number) => {
    setWidths((prev) => ({
      ...prev,
      [key]: Math.min(400, Math.max(80, (prev[key] ?? DEFAULT_COL_WIDTHS[key] ?? 100) + delta)),
    }));
  }, []);

  const resetColumn = useCallback((key: string) => {
    setWidths((prev) => ({ ...prev, [key]: DEFAULT_COL_WIDTHS[key] ?? 100 }));
  }, []);

  const startResize = useCallback((key: string, e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthsRef.current[key] ?? DEFAULT_COL_WIDTHS[key] ?? 100;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      setWidths((prev) => ({
        ...prev,
        [key]: Math.min(400, Math.max(80, startWidth + (ev.clientX - startX))),
      }));
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  return { widths, startResize, resetColumn, updateWidth };
}

export function ReviewWorkspace() {
  const { id } = useParams();
  const assessmentId = Number(id);
  const { canEdit, canApprove, isAdmin, isSubmitterScope } = useAuth();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [approving, setApproving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { widths, startResize, resetColumn, updateWidth } = useResizableColumns();
  const [isCoarsePointer] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );

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

  async function handleDelete() {
    if (!window.confirm(`Delete the assessment for "${detail?.assessment.vendor_name}"? This cannot be undone.`))
      return;
    setDeleting(true);
    try {
      await api.deleteAssessment(assessmentId);
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
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
        <Link to="/" className="font-medium text-brand-700 hover:underline">
          Back to dashboard
        </Link>
      </EmptyState>
    );
  }
  if (!detail)
    return (
      <div className="card px-6 py-12">
        <Spinner />
      </div>
    );

  const activeWidths = isCoarsePointer ? DEFAULT_COL_WIDTHS : widths;
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
            {isAdmin && (
              <>
                <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="size-4"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <span className="flex-1" aria-hidden="true" />
              </>
            )}
            {!isSubmitterScope && (
              <Link to={`/assessments/${assessmentId}/audit`} className="btn-ghost">
                Audit trail
              </Link>
            )}
            {analyzed && (
              <Link to={`/assessments/${assessmentId}/report`} className="btn-secondary">
                View report
              </Link>
            )}
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
          <p id="overall-risk-label" className="text-xs uppercase tracking-wide text-slate-500">
            Preliminary overall risk
          </p>
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
                {RISK_OPTIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
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
            <FrameworkChips
              frameworks={
                assessment.applicable_frameworks.length ? assessment.applicable_frameworks : ['ISO 27001', 'ISO 27002']
              }
            />
          </div>
        </div>
      </div>

      <EvidencePanel evidence={evidence} />

      {analyzed && <PreliminaryBanner />}

      {/* Control-by-control table */}
      {!analyzed ? (
        <div className="card px-4 py-8 text-center sm:px-6 sm:py-10">
          <p className="text-slate-600">{items.length} questionnaire items extracted.</p>
          <p className="mt-1 text-sm text-slate-500">
            Run AI analysis to classify controls, map frameworks, score risk and generate follow-ups.
          </p>
        </div>
      ) : (
        // contain:paint isolates this wide table's horizontal scroll to the container so
        // it never phantom-scrolls the whole page on narrow viewports (Chromium).
        <div className="card overflow-x-auto [contain:paint]">
          <table
            className="min-w-full divide-y divide-slate-200"
            style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}
          >
            <caption className="sr-only">Control-by-control AI analysis with analyst review actions</caption>
            <colgroup>
              <col style={{ width: activeWidths.control }} />
              <col style={{ width: activeWidths.response }} />
              <col style={{ width: activeWidths.framework }} />
              <col style={{ width: activeWidths.finding }} />
              <col style={{ width: activeWidths.evidence }} />
              <col style={{ width: activeWidths.risk }} />
              <col style={{ width: activeWidths.analyst }} />
              <col style={{ width: activeWidths.actions }} />
            </colgroup>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="relative px-3 py-3 font-medium">
                  Control area
                  {!isCoarsePointer && (
                    <button
                      type="button"
                      aria-label="Resize Control area column"
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none bg-brand-200 opacity-0 hover:opacity-100 focus-visible:opacity-100"
                      onPointerDown={(e) => startResize('control', e)}
                      onDoubleClick={() => resetColumn('control')}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') updateWidth('control', -10);
                        if (e.key === 'ArrowRight') updateWidth('control', +10);
                      }}
                    />
                  )}
                </th>
                <th scope="col" className="relative px-3 py-3 font-medium">
                  Vendor response
                  {!isCoarsePointer && (
                    <button
                      type="button"
                      aria-label="Resize Vendor response column"
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none bg-brand-200 opacity-0 hover:opacity-100 focus-visible:opacity-100"
                      onPointerDown={(e) => startResize('response', e)}
                      onDoubleClick={() => resetColumn('response')}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') updateWidth('response', -10);
                        if (e.key === 'ArrowRight') updateWidth('response', +10);
                      }}
                    />
                  )}
                </th>
                <th scope="col" className="relative px-3 py-3 font-medium">
                  Framework mapping
                  {!isCoarsePointer && (
                    <button
                      type="button"
                      aria-label="Resize Framework mapping column"
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none bg-brand-200 opacity-0 hover:opacity-100 focus-visible:opacity-100"
                      onPointerDown={(e) => startResize('framework', e)}
                      onDoubleClick={() => resetColumn('framework')}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') updateWidth('framework', -10);
                        if (e.key === 'ArrowRight') updateWidth('framework', +10);
                      }}
                    />
                  )}
                </th>
                <th scope="col" className="relative px-3 py-3 font-medium">
                  AI finding
                  {!isCoarsePointer && (
                    <button
                      type="button"
                      aria-label="Resize AI finding column"
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none bg-brand-200 opacity-0 hover:opacity-100 focus-visible:opacity-100"
                      onPointerDown={(e) => startResize('finding', e)}
                      onDoubleClick={() => resetColumn('finding')}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') updateWidth('finding', -10);
                        if (e.key === 'ArrowRight') updateWidth('finding', +10);
                      }}
                    />
                  )}
                </th>
                <th scope="col" className="relative px-3 py-3 font-medium">
                  Evidence
                  {!isCoarsePointer && (
                    <button
                      type="button"
                      aria-label="Resize Evidence column"
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none bg-brand-200 opacity-0 hover:opacity-100 focus-visible:opacity-100"
                      onPointerDown={(e) => startResize('evidence', e)}
                      onDoubleClick={() => resetColumn('evidence')}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') updateWidth('evidence', -10);
                        if (e.key === 'ArrowRight') updateWidth('evidence', +10);
                      }}
                    />
                  )}
                </th>
                <th scope="col" className="relative px-3 py-3 font-medium">
                  Risk
                  {!isCoarsePointer && (
                    <button
                      type="button"
                      aria-label="Resize Risk column"
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none bg-brand-200 opacity-0 hover:opacity-100 focus-visible:opacity-100"
                      onPointerDown={(e) => startResize('risk', e)}
                      onDoubleClick={() => resetColumn('risk')}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') updateWidth('risk', -10);
                        if (e.key === 'ArrowRight') updateWidth('risk', +10);
                      }}
                    />
                  )}
                </th>
                <th scope="col" className="relative px-3 py-3 font-medium">
                  Analyst
                  {!isCoarsePointer && (
                    <button
                      type="button"
                      aria-label="Resize Analyst column"
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none bg-brand-200 opacity-0 hover:opacity-100 focus-visible:opacity-100"
                      onPointerDown={(e) => startResize('analyst', e)}
                      onDoubleClick={() => resetColumn('analyst')}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') updateWidth('analyst', -10);
                        if (e.key === 'ArrowRight') updateWidth('analyst', +10);
                      }}
                    />
                  )}
                </th>
                <th scope="col" className="px-3 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const f = findingsByItem.get(item.id);
                if (!f) return null;
                return (
                  <FindingRow key={item.id} item={item} finding={f} canEdit={canEdit} onChange={onFindingChange} />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Analyst notes + approval (analysts/admins only; submitters & viewers see a read-only outcome) */}
      {analyzed && canEdit && (
        <div className="card space-y-3 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-slate-800">Analyst decision</h3>
          <label htmlFor="analyst-notes" className="label">
            Analyst notes
          </label>
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
