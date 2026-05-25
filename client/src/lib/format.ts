import type { AssessmentStatus, ControlStrength, EvidenceSufficiency, RiskLevel } from '../types';

// Muted, professional severity palette (soft fills + thin rings, not bright).
export const RISK_CLASSES: Record<RiskLevel, string> = {
  Low: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  High: 'bg-orange-50 text-orange-700 ring-orange-200',
  Critical: 'bg-red-50 text-red-700 ring-red-200',
};

export const STRENGTH_CLASSES: Record<ControlStrength, string> = {
  Strong: 'text-emerald-700',
  Medium: 'text-amber-700',
  Weak: 'text-orange-700',
  None: 'text-red-700',
};

export const EVIDENCE_CLASSES: Record<EvidenceSufficiency, string> = {
  Sufficient: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Insufficient: 'bg-amber-50 text-amber-700 ring-amber-200',
  None: 'bg-red-50 text-red-700 ring-red-200',
  Expired: 'bg-red-50 text-red-700 ring-red-200',
  Misaligned: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export const STATUS_LABELS: Record<AssessmentStatus, string> = {
  uploaded: 'Uploaded',
  extracted: 'Extracted',
  analyzed: 'Analyzed',
  approved: 'Approved',
};

// Neutral status chips (one muted accent for "analyzed", green only for "approved").
export const STATUS_CLASSES: Record<AssessmentStatus, string> = {
  uploaded: 'bg-slate-100 text-slate-600',
  extracted: 'bg-slate-100 text-slate-700',
  analyzed: 'bg-brand-50 text-brand-700',
  approved: 'bg-emerald-50 text-emerald-700',
};

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
