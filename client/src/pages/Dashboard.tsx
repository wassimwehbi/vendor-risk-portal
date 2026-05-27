import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type HealthInfo } from '../api/client';
import type { Assessment } from '../types';
import { RiskBadge } from '../components/RiskBadge';
import { StatusChip, ValidationChip } from '../components/StatusChip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { formatDay } from '../lib/format';
import { useAuth } from '../lib/AuthContext';
import { useVariant } from '../lib/FlagsContext';

export function Dashboard() {
  const { canSubmit, isAdmin, activeTenantId } = useAuth();
  // A/B (spec 0015): `dashboard-cta` tests a more prominent primary CTA. Both variants link
  // to the same place; only users enrolled in the running experiment see `treatment`.
  const ctaVariant = useVariant('dashboard-cta');
  const ctaClass = ctaVariant === 'treatment' ? 'btn-primary px-5 py-2.5 text-base' : 'btn-primary';
  const ctaLabel = ctaVariant === 'treatment' ? '+ Start a new assessment' : '+ New Assessment';
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [tenantNames, setTenantNames] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Admin "all tenants" mode shows which tenant each assessment belongs to.
  const showTenantCol = isAdmin && activeTenantId == null;

  // Re-fetch whenever the active tenant changes (server scopes the results).
  useEffect(() => {
    setAssessments(null);
    setError('');
    api
      .listAssessments()
      .then(setAssessments)
      .catch((e) => setError(e.message));
  }, [activeTenantId]);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!showTenantCol) return;
    api
      .listTenants()
      .then((ts) => setTenantNames(Object.fromEntries(ts.map((t) => [t.id, t.name]))))
      .catch(() => undefined);
  }, [showTenantCol]);

  async function handleDelete(a: Assessment) {
    if (!window.confirm(`Delete the assessment for "${a.vendor_name}"? This cannot be undone.`)) return;
    setDeletingId(a.id);
    try {
      await api.deleteAssessment(a.id);
      setAssessments((prev) => prev?.filter((x) => x.id !== a.id) ?? prev);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Vendor risk assessments"
        subtitle="AI-assisted preliminary analysis of SIG questionnaires against ISO 27001, ISO 27002 and GDPR."
        actions={
          canSubmit ? (
            <Link to="/assessments/new" className={ctaClass}>
              {ctaLabel}
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium ${
            health?.aiEngineAvailable ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${health?.aiEngineAvailable ? 'bg-brand-500' : 'bg-slate-400'}`}
          />
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
          {canSubmit ? (
            <>
              Create a{' '}
              <Link to="/assessments/new" className="font-medium text-brand-700 hover:underline">
                new assessment
              </Link>{' '}
              to get started.
            </>
          ) : (
            'There are no assessments to show here yet.'
          )}
        </EmptyState>
      )}

      {assessments && assessments.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Vendor risk assessments</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Vendor
                  </th>
                  {showTenantCol && (
                    <th scope="col" className="px-4 py-3 font-medium">
                      Tenant
                    </th>
                  )}
                  <th scope="col" className="px-4 py-3 font-medium">
                    Questionnaire
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Submitted
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Items
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Preliminary risk
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Validation
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assessments.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-800">{a.vendor_name}</td>
                    {showTenantCol && (
                      <td className="px-4 py-3 text-slate-600">
                        {a.tenant_id != null ? (tenantNames[a.tenant_id] ?? `#${a.tenant_id}`) : '—'}
                      </td>
                    )}
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
                      <div className="flex items-center justify-end gap-3">
                        {isAdmin && (
                          <button
                            className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                            onClick={() => handleDelete(a)}
                            disabled={deletingId === a.id}
                          >
                            {deletingId === a.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                        <Link to={`/assessments/${a.id}`} className="font-medium text-brand-700 hover:underline">
                          Open<span className="sr-only"> {a.vendor_name} assessment</span> →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
