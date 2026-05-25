import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorNote, PageHeader } from '../components/ui';
import { useRole } from '../lib/RoleContext';

// Per-questionnaire-type sample templates (served statically from /public/samples).
// Each is a blank fill-in template with the column structure the uploader expects.
const SAMPLE_TEMPLATES: Record<string, string> = {
  'SIG Lite': '/samples/sig-lite.csv',
  'SIG Core': '/samples/sig-core.csv',
  'SIG Full': '/samples/sig-full.csv',
};
// "Custom" has no canonical template — fall back to the Core sample.
function sampleUrlFor(type: string): string {
  return SAMPLE_TEMPLATES[type] ?? SAMPLE_TEMPLATES['SIG Core'];
}

// Supported evidence file types (mirrors ALLOWED_EVIDENCE_ACCEPT on the server).
const EVIDENCE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.svg';

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

  const isCustom = !SAMPLE_TEMPLATES[type];
  const sampleUrl = sampleUrlFor(type);
  const sampleLabel = isCustom ? 'sample SIG questionnaire' : `sample ${type} questionnaire`;

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
          <label htmlFor="na-vendor" className="label">Vendor name</label>
          <input id="na-vendor" className="input" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Acme Corp" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="na-type" className="label">Questionnaire type</label>
            <select id="na-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option>SIG Core</option>
              <option>SIG Lite</option>
              <option>SIG Full</option>
              <option>Custom</option>
            </select>
          </div>
          <div>
            <label htmlFor="na-date" className="label">Date submitted</label>
            <input id="na-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="na-questionnaire" className="label">SIG questionnaire (.xlsx, .xls, .csv)</label>
          <input
            id="na-questionnaire"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="input"
            onChange={(e) => setQuestionnaire(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Not sure what to fill in?{' '}
            <a href={sampleUrl} download className="font-medium text-brand-700 hover:underline">
              Download a {sampleLabel}
            </a>{' '}
            template and complete the response columns.
            {isCustom && <span className="text-slate-500"> (based on SIG Core)</span>}
          </p>
        </div>
        <div>
          <label htmlFor="na-evidence" className="label">Evidence files (optional — SOC 2, ISO cert, policies, screenshots)</label>
          <input
            id="na-evidence"
            type="file"
            multiple
            accept={EVIDENCE_ACCEPT}
            className="input"
            onChange={(e) => setEvidence(Array.from(e.target.files ?? []))}
          />
          <p className="mt-1 text-xs text-slate-500">
            Supported: PDF, Word (.doc/.docx), CSV, Excel (.xls/.xlsx), images (PNG/JPG/GIF/WebP/BMP/TIFF). Text is
            extracted from documents on upload (images are stored without OCR). Max 20 files, 25 MB each.
          </p>
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
