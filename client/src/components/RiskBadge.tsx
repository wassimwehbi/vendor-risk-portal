import type { RiskLevel } from '../types';
import { RISK_CLASSES } from '../lib/format';

export function RiskBadge({ level, size = 'sm' }: { level: RiskLevel | null; size?: 'sm' | 'lg' }) {
  if (!level) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
        Not analyzed
      </span>
    );
  }
  const sizing = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ring-1 ring-inset ${sizing} ${RISK_CLASSES[level]}`}
    >
      {level}
    </span>
  );
}
