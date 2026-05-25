import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AuditEntry } from '../types';
import { EmptyState, PageHeader, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

const ACTION_LABELS: Record<string, string> = {
  assessment_created: 'Assessment created',
  items_extracted: 'Questionnaire extracted',
  evidence_uploaded: 'Evidence uploaded',
  demo_scenario_loaded: 'Demo scenario loaded',
  ai_analysis: 'AI analysis run',
  finding_updated: 'Finding updated',
  assessment_updated: 'Assessment updated',
  assessment_approved: 'Assessment approved',
};

export function AuditTrail() {
  const { id } = useParams();
  const assessmentId = Number(id);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAudit(assessmentId).then(setEntries).catch((e) => setError(e.message));
  }, [assessmentId]);

  return (
    <div>
      <PageHeader
        title="Audit trail"
        subtitle="Immutable record of uploads, AI analysis, analyst changes and final validation."
        actions={<Link to={`/assessments/${assessmentId}`} className="btn-ghost">← Back to review</Link>}
      />
      {error && (
        <EmptyState title="Audit trail unavailable">
          It may not exist, or you don’t have access to it.{' '}
          <Link to="/" className="font-medium text-brand-700 hover:underline">Back to dashboard</Link>
        </EmptyState>
      )}
      {!entries && !error && <div className="card px-6 py-12"><Spinner /></div>}
      {entries && (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Audit trail entries</caption>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">When</th>
                <th scope="col" className="px-4 py-3 font-medium">Action</th>
                <th scope="col" className="px-4 py-3 font-medium">Actor</th>
                <th scope="col" className="px-4 py-3 font-medium">Role</th>
                <th scope="col" className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(e.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className="px-4 py-3 text-slate-600">{e.actor}</td>
                  <td className="px-4 py-3 text-slate-600">{e.role}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {e.details ? (
                      <code className="break-all">{JSON.stringify(e.details)}</code>
                    ) : (
                      '—'
                    )}
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
