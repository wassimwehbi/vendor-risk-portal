import { useId, useState } from 'react';
import type { EvidenceFile, EvidenceKind, EvidenceParseStatus } from '../types';

const KIND_LABEL: Record<EvidenceKind, string> = {
  pdf: 'PDF',
  word: 'Word',
  excel: 'Excel',
  csv: 'CSV',
  image: 'Image',
  unknown: 'File',
};

const STATUS_CLASSES: Record<EvidenceParseStatus, string> = {
  extracted: 'bg-green-50 text-green-700 ring-green-600/20',
  no_text: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  empty: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  unsupported: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  error: 'bg-red-50 text-red-700 ring-red-600/20',
};

const STATUS_LABEL: Record<EvidenceParseStatus, string> = {
  extracted: 'Text extracted',
  no_text: 'No text',
  empty: 'Empty',
  unsupported: 'Not parsed',
  error: 'Parse error',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function EvidenceItem({ ev }: { ev: EvidenceFile }) {
  const [open, setOpen] = useState(false);
  const textId = useId();
  const hasText = Boolean(ev.extracted_text && ev.extracted_text.length > 0);
  const isAiDescription = ev.kind === 'image' && (ev.parse_note?.startsWith('Vision') ?? false);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
          {KIND_LABEL[ev.kind]}
        </span>
        <span className="break-all text-sm font-medium text-slate-800">{ev.original_name}</span>
        <span className="text-xs text-slate-500">{formatBytes(ev.size)}</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLASSES[ev.parse_status]}`}
        >
          {STATUS_LABEL[ev.parse_status]}
          {ev.parse_status === 'extracted' && ev.extracted_chars > 0
            ? ` · ${ev.extracted_chars.toLocaleString()} chars`
            : ''}
        </span>
        {isAiDescription && (
          <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
            <svg aria-hidden="true" className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a.5.5 0 0 1 .447.276l1.405 2.848 3.144.457a.5.5 0 0 1 .277.853L10.99 7.56l.537 3.132a.5.5 0 0 1-.726.527L8 9.773l-2.801 1.446a.5.5 0 0 1-.726-.527l.537-3.132-2.283-2.126a.5.5 0 0 1 .277-.853l3.144-.457L7.553 1.276A.5.5 0 0 1 8 1z" />
            </svg>
            AI described
          </span>
        )}
        {hasText && (
          <button
            type="button"
            className="text-xs font-medium text-brand-700 hover:underline"
            aria-expanded={open}
            aria-controls={textId}
            onClick={() => setOpen((o) => !o)}
          >
            {open
              ? isAiDescription
                ? 'Hide AI description'
                : 'Hide extracted text'
              : isAiDescription
                ? 'Show AI description'
                : 'Show extracted text'}
            <span className="sr-only"> for {ev.original_name}</span>
          </button>
        )}
      </div>
      {ev.parse_note && <p className="mt-1 text-xs text-slate-500">{ev.parse_note}</p>}
      {open && hasText && (
        <pre
          id={textId}
          className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-200 whitespace-pre-wrap"
        >
          {ev.extracted_text}
        </pre>
      )}
    </li>
  );
}

export function EvidencePanel({ evidence }: { evidence: EvidenceFile[] }) {
  if (!evidence || evidence.length === 0) return null;
  const extracted = evidence.filter((e) => e.parse_status === 'extracted').length;
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-800">Evidence files ({evidence.length})</h3>
        <span className="text-xs text-slate-500">{extracted} parsed with extractable text</span>
      </div>
      <ul className="mt-2 divide-y divide-slate-100">
        {evidence.map((ev) => (
          <EvidenceItem key={ev.id} ev={ev} />
        ))}
      </ul>
    </div>
  );
}
