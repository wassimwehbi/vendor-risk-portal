import type { ReactNode } from 'react';
import type { ExperimentStatus, VariantComparison } from '../types';

export function StatusPill({ status }: { status: ExperimentStatus }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function Banner({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

/** Format a 0..1 rate as a percentage. */
export function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Short significance readout for a two-proportion comparison. */
export function significanceLabel(c: VariantComparison): string {
  if (c.pValue === null) return 'n/a';
  return `p=${c.pValue.toFixed(3)} ${c.pValue < 0.05 ? '✓ significant' : '· not yet significant'}`;
}
