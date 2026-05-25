import type { AssessmentStatus, ValidationStatus } from '../types';
import { STATUS_CLASSES, STATUS_LABELS } from '../lib/format';

export function StatusChip({ status }: { status: AssessmentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ValidationChip({ status }: { status: ValidationStatus }) {
  const cls = status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status === 'approved' ? '✓ Validated' : 'Pending validation'}
    </span>
  );
}
