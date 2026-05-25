import { useId, useState } from 'react';
import type { EvidenceSufficiency, Finding, FrameworkMapping, QuestionnaireItem, RiskLevel } from '../types';
import { effectiveFinding } from '../types';
import { api } from '../api/client';
import { RiskBadge } from './RiskBadge';
import { EVIDENCE_CLASSES, STRENGTH_CLASSES } from '../lib/format';

const RISK_OPTIONS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];
const EVIDENCE_OPTIONS: EvidenceSufficiency[] = ['Sufficient', 'Insufficient', 'None', 'Expired', 'Misaligned'];

const RESPONSE_TYPE_CLASSES: Record<string, string> = {
  Yes: 'bg-green-50 text-green-700',
  No: 'bg-red-50 text-red-700',
  Partial: 'bg-amber-50 text-amber-700',
  'N/A': 'bg-slate-100 text-slate-500',
  FreeText: 'bg-slate-100 text-slate-600',
};

// "Framework: ref1; ref2" per line <-> FrameworkMapping[]
function formatMappings(mappings: FrameworkMapping[]): string {
  return mappings.map((m) => `${m.framework}: ${m.references.join('; ')}`).join('\n');
}
function parseMappings(text: string): FrameworkMapping[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return { framework: line, references: [] };
      const framework = line.slice(0, idx).trim();
      const references = line
        .slice(idx + 1)
        .split(';')
        .map((r) => r.trim())
        .filter(Boolean);
      return { framework, references };
    })
    .filter((m) => m.framework.length > 0);
}

export function FindingRow({
  item,
  finding,
  canEdit,
  onChange,
}: {
  item: QuestionnaireItem;
  finding: Finding;
  canEdit: boolean;
  onChange: (f: Finding) => void;
}) {
  const eff = effectiveFinding(finding);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Unique field ids so labels associate correctly across many rendered rows.
  const fid = useId();

  // edit form state
  const [domain, setDomain] = useState(eff.control_domain);
  const [risk, setRisk] = useState<RiskLevel>(eff.risk_level);
  const [evidence, setEvidence] = useState<EvidenceSufficiency>(eff.evidence_sufficiency);
  const [mappings, setMappings] = useState(formatMappings(eff.framework_mappings));
  const [followUps, setFollowUps] = useState(eff.follow_up_questions.join('\n'));

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const updated = await api.patchFinding(finding.id, {
        control_domain: domain,
        risk_level: risk,
        evidence_sufficiency: evidence,
        framework_mappings: parseMappings(mappings),
        follow_up_questions: followUps.split('\n').map((s) => s.trim()).filter(Boolean),
        analyst_status: 'overridden',
      });
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    setErr('');
    try {
      const updated = await api.patchFinding(finding.id, { analyst_status: 'accepted' });
      onChange(updated);
      // reset local edit fields to AI values
      setDomain(updated.control_domain);
      setRisk(updated.risk_level);
      setEvidence(updated.evidence_sufficiency);
      setMappings(formatMappings(updated.framework_mappings));
      setFollowUps(updated.follow_up_questions.join('\n'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const statusBadge =
    finding.analyst_status === 'accepted' ? (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Accepted</span>
    ) : finding.analyst_status === 'overridden' ? (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Overridden</span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Pending</span>
    );

  return (
    <>
      <tr className="align-top hover:bg-slate-50/60">
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-left"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} details for ${eff.control_domain} (${item.question_id})`}
          >
            <span className="font-medium text-slate-800">{eff.control_domain}</span>
            <span aria-hidden="true" className="ml-1 text-slate-400">{open ? '▾' : '▸'}</span>
            <span className="block text-xs text-slate-500">{item.question_id}</span>
          </button>
        </td>
        <td className="px-3 py-3">
          <span className={`mb-1 inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${RESPONSE_TYPE_CLASSES[item.response_type] ?? 'bg-slate-100'}`}>
            {item.response_type}
          </span>
          <p className="line-clamp-2 max-w-[18rem] text-sm text-slate-700">{item.response || <span className="italic text-slate-500">(blank)</span>}</p>
        </td>
        <td className="px-3 py-3 text-xs text-slate-600">
          {eff.framework_mappings.length === 0 ? (
            <span className="text-slate-500">—</span>
          ) : (
            <ul className="space-y-0.5">
              {eff.framework_mappings.map((m) => (
                <li key={m.framework}>
                  <span className="font-medium text-slate-700">{m.framework}:</span> {m.references.join('; ')}
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-3 py-3 text-sm text-slate-700">
          <p className="max-w-[16rem]">{finding.ai_finding}</p>
          <p className="mt-1 text-xs text-slate-500">
            strength <span className={STRENGTH_CLASSES[finding.control_strength]}>{finding.control_strength}</span> · {finding.completeness}
          </p>
        </td>
        <td className="px-3 py-3">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${EVIDENCE_CLASSES[eff.evidence_sufficiency]}`}>
            {eff.evidence_sufficiency}
          </span>
        </td>
        <td className="px-3 py-3">
          <RiskBadge level={eff.risk_level} />
        </td>
        <td className="px-3 py-3">{statusBadge}</td>
        <td className="px-3 py-3 text-right">
          {canEdit && (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                className="text-xs font-medium text-brand-700 hover:underline"
                aria-expanded={editing}
                onClick={() => { setOpen(true); setEditing((e) => !e); }}
              >
                {editing ? 'Close' : 'Override'}
                <span className="sr-only"> {eff.control_domain} finding</span>
              </button>
              {finding.analyst_status !== 'accepted' && (
                <button
                  type="button"
                  className="text-xs font-medium text-green-700 hover:underline"
                  onClick={accept}
                  disabled={busy}
                >
                  Accept AI<span className="sr-only"> finding for {eff.control_domain}</span>
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/70">
          <td colSpan={8} className="px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 break-words text-sm">
                <p><span className="font-medium text-slate-600">Question:</span> {item.question_text}</p>
                {item.vendor_comments && <p><span className="font-medium text-slate-600">Vendor comments:</span> {item.vendor_comments}</p>}
                <p><span className="font-medium text-slate-600">Evidence provided:</span> {item.evidence_text || '(none)'} {item.evidence_location ? `— ${item.evidence_location}` : ''}</p>
                {item.expiration_date && <p><span className="font-medium text-slate-600">Expiration:</span> {item.expiration_date}</p>}
                <p className="text-slate-500"><span className="font-medium text-slate-600">AI rationale:</span> {finding.ai_rationale}</p>
                <div>
                  <p className="font-medium text-slate-600">Follow-up questions:</p>
                  <ul className="ml-4 list-disc text-slate-600">
                    {eff.follow_up_questions.length === 0 ? <li className="text-slate-500">None</li> : eff.follow_up_questions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              </div>
              {editing && canEdit && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Analyst override</p>
                  {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${fid}-domain`} className="label text-xs">Control area</label>
                      <input id={`${fid}-domain`} className="input" value={domain} onChange={(e) => setDomain(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor={`${fid}-risk`} className="label text-xs">Risk level</label>
                      <select id={`${fid}-risk`} className="input" value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)}>
                        {RISK_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`${fid}-evidence`} className="label text-xs">Evidence sufficiency</label>
                    <select id={`${fid}-evidence`} className="input" value={evidence} onChange={(e) => setEvidence(e.target.value as EvidenceSufficiency)}>
                      {EVIDENCE_OPTIONS.map((ev) => <option key={ev}>{ev}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${fid}-mappings`} className="label text-xs">Framework mapping (one per line — <code>Framework: ref1; ref2</code>)</label>
                    <textarea id={`${fid}-mappings`} className="input h-24 font-mono text-xs" value={mappings} onChange={(e) => setMappings(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor={`${fid}-followups`} className="label text-xs">Follow-up questions (one per line)</label>
                    <textarea id={`${fid}-followups`} className="input h-24" value={followUps} onChange={(e) => setFollowUps(e.target.value)} />
                  </div>
                  <div className="flex justify-end">
                    <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save override'}</button>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
