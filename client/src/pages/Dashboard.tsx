import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type HealthInfo } from '../api/client';
import type { Assessment } from '../types';
import { RiskBadge } from '../components/RiskBadge';
import { StatusChip, ValidationChip } from '../components/StatusChip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { formatDay } from '../lib/format';

export function Dashboard() {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listAssessments().then(setAssessments).catch((e) => setError(e.message));
    api.health().then(setHealth).catch(() => undefined);
  }, []);

  return (
    <div>
      <PageHeader
        title="Vendor risk assessments"
        subtitle="AI-assisted preliminary analysis of SIG questionnaires against ISO 27001, ISO 27002 and GDPR."
        actions={
          <>
            <Link to="/showcase" className="btn-secondary">
              Demo Showcase
            </Link>
            <Link to="/assessments/new" className="btn-primary">
              + New Assessment
            </Link>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium ${
            health?.aiEngineAvailable ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${health?.aiEngineAvailable ? 'bg-brand-500' : 'bg-slate-400'}`} />
          AI engine: {health ? (health.aiEngineAvailable ? 'Claude (API key detected)' : 'Rule-based (offline)') : '…'}
        </span>
      </div>

      {error && <ErrorNote message={error} />}
      {!assessments && !error && (
        <div className="card px-6 py-12">
          <Spinner />
        </div>
      )}

      {assessments && assessments.length === 0 && (
        <EmptyState title="No assessments yet">
          Start with the{' '}
          <Link to="/showcase" className="font-medium text-brand-700 hover:underline">
            Demo Showcase
          </Link>{' '}
          or create a{' '}
          <Link to="/assessments/new" className="font-medium text-brand-700 hover:underline">
            new assessment
          </Link>
          .
        </EmptyState>
      )}

      {assessments && assessments.length > 0 && (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 font-medium">Questionnaire</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Preliminary risk</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Validation</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assessments.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{a.vendor_name}</td>
                  <td className="px-4 py-3 text-slate-600">{a.questionnaire_type}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDay(a.date_submitted)}</td>
                  <td className="px-4 py-3 text-slate-600">{a.item_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <RiskBadge level={a.overall_risk} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={a.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ValidationChip status={a.validation_status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/assessments/${a.id}`} className="font-medium text-brand-700 hover:underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
