import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ScenarioSummary } from '../types';
import { DATA_CATEGORY_LABELS } from '../types';
import { RiskBadge } from '../components/RiskBadge';
import { DataCategoryChips, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/AuthContext';

export function DemoShowcase() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const { canEdit, isAdmin, activeTenantId } = useAuth();
  const needsTenant = isAdmin && activeTenantId == null;

  useEffect(() => {
    api.listScenarios().then(setScenarios).catch((e) => setError(e.message));
  }, []);

  async function runScenario(key: string) {
    setBusyKey(key);
    setError('');
    try {
      const assessment = await api.loadScenario(key);
      await api.analyze(assessment.id);
      navigate(`/assessments/${assessment.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusyKey(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Demo Showcase"
        subtitle="Five pre-built vendor scenarios spanning every risk level. One click loads the questionnaire and runs AI-assisted analysis."
      />
      {!canEdit && (
        <div className="mb-4">
          <ErrorNote message="Your role in this tenant cannot load demo scenarios." />
        </div>
      )}
      {canEdit && needsTenant && (
        <div className="mb-4">
          <ErrorNote message="Select a tenant (top-right) to load a demo scenario into." />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      {!scenarios && !error && (
        <div className="card px-6 py-12">
          <Spinner />
        </div>
      )}
      {scenarios && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scenarios.map((s) => (
            <div key={s.key} className="card flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900">{s.vendor_name}</h3>
                  <p className="text-xs text-slate-500">{s.sector}</p>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] uppercase tracking-wide text-slate-400">Expected</span>
                  <RiskBadge level={s.expected_risk} />
                </div>
              </div>
              <p className="text-sm text-slate-600">{s.summary}</p>
              <div>
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">Data processed</span>
                <DataCategoryChips categories={s.data_categories} labels={DATA_CATEGORY_LABELS} />
              </div>
              <button
                className="btn-primary mt-auto w-full"
                disabled={!canEdit || needsTenant || busyKey !== null}
                onClick={() => runScenario(s.key)}
              >
                {busyKey === s.key ? 'Analyzing…' : 'Load & Analyze'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
