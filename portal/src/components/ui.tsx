import type { ReactNode } from 'react';
import type { ExperimentStatus, VariantComparison } from '../types';

export function StatusPill({ status }: { status: ExperimentStatus }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function Banner({ kind, children }: { kind: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

/**
 * AI-attribution chip — the design system's brand-50/700 + sparkles provenance marker. Used
 * wherever AI output is surfaced (per design-system/DESIGN_SYSTEM.md §AI ATTRIBUTION). Tiny
 * inline Lucide-style sparkles SVG; intentionally a footnote, not a banner.
 */
export function AiChip({ label = 'AI' }: { label?: string }) {
  return (
    <span className="chip-ai" aria-label="AI-generated">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
        <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
      </svg>
      {label}
    </span>
  );
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
