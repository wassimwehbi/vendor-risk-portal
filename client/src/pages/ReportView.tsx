import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ReportData } from '../types';
import { DATA_CATEGORY_LABELS, effectiveFinding } from '../types';
import { RiskBadge } from '../components/RiskBadge';
import { DataCategoryChips, ErrorNote, FrameworkChips, Spinner } from '../components/ui';
import { formatDate, formatDay } from '../lib/format';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

export function ReportView() {
  const { id } = useParams();
  const assessmentId = Number(id);
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getReport(assessmentId).then(setReport).catch((e) => setError(e.message));
  }, [assessmentId]);

  if (error) return <ErrorNote message={error} />;
  if (!report) return <div className="card px-6 py-12"><Spinner /></div>;

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between">
        <Link to={`/assessments/${assessmentId}`} className="btn-ghost">← Back to review</Link>
        <div className="flex gap-2">
          <a className="btn-secondary" href={api.exportUrl(assessmentId, 'csv')}>Export CSV</a>
          <a className="btn-secondary" href={api.exportUrl(assessmentId, 'xlsx')}>Export Excel</a>
          <button className="btn-primary" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      <div className="card space-y-6 p-6">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{report.vendor_name}</h1>
            <p className="text-sm text-slate-500">Vendor Risk Analyst Review Report</p>
          </div>
          <div className="text-right">
            <RiskBadge level={report.overall_risk} size="lg" />
            <p className="mt-1 text-xs text-slate-400">Generated {formatDate(report.generated_at)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          AI output is preliminary. Final vendor-risk decisions are made by a human analyst, never automatically by the AI.
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Questionnaire">{report.questionnaire_type}</Field>
          <Field label="Date submitted">{formatDay(report.date_submitted)}</Field>
          <Field label="AI engine">{report.ai_engine_used ?? '—'}</Field>
          <Field label="Mapping version">{report.mapping_version ?? '—'}</Field>
          <Field label="Data processed"><DataCategoryChips categories={report.data_categories} labels={DATA_CATEGORY_LABELS} /></Field>
          <Field label="Applicable frameworks"><FrameworkChips frameworks={report.applicable_frameworks} /></Field>
          <Field label="Validation">
            {report.validation_status === 'approved' ? (
              <span className="text-green-700">Approved by {report.validated_by} ({formatDate(report.validated_at)})</span>
            ) : (
              <span className="text-slate-500">Pending analyst validation</span>
            )}
          </Field>
          <Field label="Controls assessed">{report.controls.length}</Field>
        </div>

        {/* Control-by-control */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Control-by-control assessment</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Control area</th>
                  <th className="px-3 py-2 font-medium">Vendor response</th>
                  <th className="px-3 py-2 font-medium">Framework mapping</th>
                  <th className="px-3 py-2 font-medium">AI finding</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                  <th className="px-3 py-2 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {report.controls.map(({ item, finding }) => {
                  const eff = effectiveFinding(finding);
                  return (
                    <tr key={finding.id}>
                      <td className="px-3 py-2 font-medium text-slate-700">{eff.control_domain}</td>
                      <td className="px-3 py-2 text-slate-600">{item.response || '(blank)'}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {eff.framework_mappings.map((m) => `${m.framework}: ${m.references.join('; ')}`).join(' | ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{finding.ai_finding}</td>
                      <td className="px-3 py-2"><RiskBadge level={eff.risk_level} /></td>
                      <td className="px-3 py-2 text-xs text-slate-500">{eff.follow_up_questions.join(' • ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Missing / weak controls ({report.weak_or_missing.length})</h2>
            <ul className="ml-4 list-disc space-y-1 text-sm text-slate-600">
              {report.weak_or_missing.length === 0 ? <li className="text-slate-400">None identified</li> : report.weak_or_missing.map((f) => (
                <li key={f.id}>{effectiveFinding(f).control_domain}: {f.ai_finding}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Evidence gaps ({report.evidence_gaps.length})</h2>
            <ul className="ml-4 list-disc space-y-1 text-sm text-slate-600">
              {report.evidence_gaps.length === 0 ? <li className="text-slate-400">None identified</li> : report.evidence_gaps.map((f) => (
                <li key={f.id}>{effectiveFinding(f).control_domain}: {effectiveFinding(f).evidence_sufficiency}</li>
              ))}
            </ul>
          </section>
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Recommended follow-up questions ({report.follow_ups.length})</h2>
          <ul className="ml-4 list-decimal space-y-1 text-sm text-slate-600">
            {report.follow_ups.length === 0 ? <li className="text-slate-400">None</li> : report.follow_ups.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Analyst notes</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-600">{report.analyst_notes || <span className="text-slate-400">No notes added.</span>}</p>
        </section>
      </div>
    </div>
  );
}
