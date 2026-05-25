import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import imageSize from 'image-size';
// pdf-parse's package entry runs a debug harness when imported directly; the
// library implementation lives at lib/pdf-parse.js and is the safe import.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { EvidenceKind, EvidenceParseStatus } from '../types';

/**
 * Evidence intake parsing layer.
 *
 * We accept a fixed allow-list of evidence types (PDF, Word, CSV, Excel, image)
 * and extract machine-readable text where possible so the attached documents can
 * inform analyst review (and, later, the AI analysis) rather than being opaque
 * blobs. Images are recognised and their dimensions recorded, but are not OCR'd
 * in this version (kept deliberately offline-friendly — no runtime model
 * downloads); their status is `no_text`.
 */

interface TypeSpec {
  kind: Exclude<EvidenceKind, 'unknown'>;
  exts: string[];
  mimes: string[];
}

const TYPES: TypeSpec[] = [
  { kind: 'pdf', exts: ['.pdf'], mimes: ['application/pdf'] },
  {
    kind: 'word',
    exts: ['.doc', '.docx'],
    mimes: [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  {
    kind: 'excel',
    exts: ['.xls', '.xlsx', '.xlsm'],
    mimes: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
  { kind: 'csv', exts: ['.csv'], mimes: ['text/csv', 'application/csv'] },
  {
    kind: 'image',
    exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'],
    mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/svg+xml'],
  },
];

/** Human-readable list of accepted evidence types (for error messages / UI). */
export const ALLOWED_EVIDENCE_LABEL = 'PDF, Word (.doc/.docx), CSV, Excel (.xls/.xlsx), or image (PNG/JPG/GIF/WebP/BMP/TIFF)';

/** Accept attribute string for the file input on the client (mirrored there). */
export const ALLOWED_EVIDENCE_ACCEPT = TYPES.flatMap((t) => t.exts).join(',');

/**
 * Returns the evidence kind for a file, or null if it is not an allowed type.
 * Matches on extension first, then MIME type.
 */
export function classifyEvidence(originalName: string, mimeType: string): Exclude<EvidenceKind, 'unknown'> | null {
  const ext = extname(originalName || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  for (const t of TYPES) {
    if (ext && t.exts.includes(ext)) return t.kind;
  }
  for (const t of TYPES) {
    if (mime && t.mimes.includes(mime)) return t.kind;
  }
  return null;
}

export function isAllowedEvidence(originalName: string, mimeType: string): boolean {
  return classifyEvidence(originalName, mimeType) !== null;
}

export interface EvidenceExtractionResult {
  kind: EvidenceKind;
  status: EvidenceParseStatus;
  text: string;
  chars: number;
  note: string | null;
}

// Cap stored text so a huge document can't bloat the DB / API payloads.
const MAX_TEXT = 200_000;

// Light whitespace normalisation: collapse runs of spaces/tabs, trim blank-line
// runs, and trim ends — WITHOUT removing the spaces that separate words.
function clip(text: string): { text: string; chars: number; truncated: boolean } {
  const normalized = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= MAX_TEXT) return { text: normalized, chars: normalized.length, truncated: false };
  return { text: normalized.slice(0, MAX_TEXT), chars: normalized.length, truncated: true };
}

async function extractPdf(buf: Buffer): Promise<EvidenceExtractionResult> {
  const data = await pdfParse(buf);
  const { text, chars, truncated } = clip(data.text || '');
  const pages = data.numpages ?? 0;
  if (!text) {
    return { kind: 'pdf', status: 'no_text', text: '', chars: 0, note: `PDF with ${pages} page(s); no extractable text (may be scanned — OCR not performed).` };
  }
  return {
    kind: 'pdf',
    status: 'extracted',
    text,
    chars,
    note: `${pages} page(s)${truncated ? `; text truncated to ${MAX_TEXT} chars` : ''}.`,
  };
}

async function extractWord(buf: Buffer, ext: string): Promise<EvidenceExtractionResult> {
  if (ext === '.doc') {
    // Legacy binary .doc is not supported by mammoth (which handles OOXML .docx).
    return { kind: 'word', status: 'unsupported', text: '', chars: 0, note: 'Legacy .doc format — stored but not text-extracted. Please provide .docx or PDF for parsing.' };
  }
  const result = await mammoth.extractRawText({ buffer: buf });
  const { text, chars, truncated } = clip(result.value || '');
  if (!text) return { kind: 'word', status: 'empty', text: '', chars: 0, note: 'Document contained no extractable text.' };
  return { kind: 'word', status: 'extracted', text, chars, note: truncated ? `Text truncated to ${MAX_TEXT} chars.` : null };
}

function extractSpreadsheet(buf: Buffer, kind: 'excel' | 'csv'): EvidenceExtractionResult {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).trim();
    if (csv) parts.push(wb.SheetNames.length > 1 ? `# Sheet: ${name}\n${csv}` : csv);
  }
  const { text, chars, truncated } = clip(parts.join('\n\n'));
  if (!text) return { kind, status: 'empty', text: '', chars: 0, note: 'No rows found.' };
  const sheetNote = kind === 'excel' ? `${wb.SheetNames.length} sheet(s)` : 'CSV';
  return { kind, status: 'extracted', text, chars, note: `${sheetNote}${truncated ? `; text truncated to ${MAX_TEXT} chars` : ''}.` };
}

function describeImage(buf: Buffer): EvidenceExtractionResult {
  let note = 'Image stored; text/OCR extraction is not performed in this version.';
  try {
    const dim = imageSize(buf);
    if (dim?.width && dim?.height) note = `Image ${dim.width}×${dim.height} (${dim.type ?? 'image'}); text/OCR not performed.`;
  } catch {
    /* dimensions are best-effort */
  }
  return { kind: 'image', status: 'no_text', text: '', chars: 0, note };
}

/**
 * Parse a single uploaded evidence file. Never throws — parsing failures are
 * captured as an `error` status so one bad file cannot fail the whole upload.
 */
export async function extractEvidence(
  filePath: string,
  originalName: string,
  mimeType: string,
): Promise<EvidenceExtractionResult> {
  const kind = classifyEvidence(originalName, mimeType);
  if (!kind) {
    return { kind: 'unknown', status: 'unsupported', text: '', chars: 0, note: `Unsupported evidence type. Allowed: ${ALLOWED_EVIDENCE_LABEL}.` };
  }
  const ext = extname(originalName || '').toLowerCase();
  try {
    const buf = readFileSync(filePath);
    switch (kind) {
      case 'pdf':
        return await extractPdf(buf);
      case 'word':
        return await extractWord(buf, ext);
      case 'excel':
        return extractSpreadsheet(buf, 'excel');
      case 'csv':
        return extractSpreadsheet(buf, 'csv');
      case 'image':
        return describeImage(buf);
    }
  } catch (err) {
    return { kind, status: 'error', text: '', chars: 0, note: `Could not parse file: ${(err as Error).message}` };
  }
}
