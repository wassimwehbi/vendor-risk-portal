import type { ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-slate-500">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-base font-medium text-slate-700">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DataCategoryChips({ categories, labels }: { categories: string[]; labels: Record<string, string> }) {
  if (categories.length === 0) return <span className="text-sm text-slate-500">None detected</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((c) => (
        <span key={c} className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {labels[c] ?? c}
        </span>
      ))}
    </div>
  );
}

export function FrameworkChips({ frameworks }: { frameworks: string[] }) {
  if (frameworks.length === 0) return <span className="text-sm text-slate-500">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {frameworks.map((f) => (
        <span key={f} className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
          {f}
        </span>
      ))}
    </div>
  );
}
