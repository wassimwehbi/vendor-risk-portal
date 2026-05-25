import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorNote, PageHeader } from '../components/ui';
import { useRole } from '../lib/RoleContext';

export function NewAssessment() {
  const navigate = useNavigate();
  const { canEdit } = useRole();
  const [vendorName, setVendorName] = useState('');
  const [type, setType] = useState('SIG Core');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [questionnaire, setQuestionnaire] = useState<File | null>(null);
  const [evidence, setEvidence] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorName.trim()) return setError('Vendor name is required.');
    if (!questionnaire) return setError('Please choose a SIG questionnaire file (.xlsx, .xls or .csv).');
    setBusy(true);
    setError('');
    try {
      const assessment = await api.createAssessment({ vendor_name: vendorName.trim(), questionnaire_type: type, date_submitted: date });
      await api.uploadFiles(assessment.id, questionnaire, evidence);
      navigate(`/assessments/${assessment.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New assessment" subtitle="Upload a completed SIG questionnaire and any supporting evidence." />
      {!canEdit && (
        <div className="mb-4">
          <ErrorNote message="The current role is Viewer. Switch to Analyst or Admin (top-right) to create an assessment." />
        </div>
      )}
      <form onSubmit={submit} className="card flex flex-col gap-4 p-6">
        {error && <ErrorNote message={error} />}
        <div>
          <label className="label">Vendor name</label>
          <input className="input" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Acme Corp" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Questionnaire type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option>SIG Core</option>
              <option>SIG Lite</option>
              <option>SIG Full</option>
              <option>Custom</option>
            </select>
          </div>
          <div>
            <label className="label">Date submitted</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">SIG questionnaire (.xlsx, .xls, .csv)</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="input"
            onChange={(e) => setQuestionnaire(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-xs text-slate-500">
            A sample file is provided at <code className="rounded bg-slate-100 px-1">server/src/data/sample-sig.csv</code>.
          </p>
        </div>
        <div>
          <label className="label">Evidence files (optional — SOC 2, ISO cert, policies, screenshots)</label>
          <input
            type="file"
            multiple
            className="input"
            onChange={(e) => setEvidence(Array.from(e.target.files ?? []))}
          />
          {evidence.length > 0 && <p className="mt-1 text-xs text-slate-500">{evidence.length} evidence file(s) attached.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => navigate('/')}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!canEdit || busy}>
            {busy ? 'Uploading…' : 'Upload & extract'}
          </button>
        </div>
      </form>
    </div>
  );
}
