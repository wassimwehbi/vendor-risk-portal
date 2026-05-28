import { readFile } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { NewQuestionnaireItem, ResponseType } from '../types';

/**
 * Parses an uploaded SIG questionnaire (.xlsx / .xls / .csv / .docx / .pdf) into
 * structured questionnaire items. Column headers are matched case-insensitively using
 * the alias sets below, so a variety of SIG-style exports are supported.
 *
 * Expected columns (aliases):
 *   question_id      <- Question ID | ID | Q# | Ref | Question Number | #
 *   question_text    <- Question | Question Text | Description | Control Question
 *   response         <- Response | Answer | Vendor Response
 *   response_type    <- Response Type | Type | Answer Type   (inferred if absent)
 *   evidence_text    <- Evidence | Evidence Provided | Supporting Evidence
 *   evidence_location<- Evidence Location | Reference | Document Reference | Location
 *   vendor_comments  <- Comments | Vendor Comments | Notes | Remarks
 *   relevant_date    <- Date | Relevant Date | Response Date
 *   expiration_date  <- Expiration Date | Expiry | Valid Until | Cert Expiration
 */

const ALIASES: Record<keyof NewQuestionnaireItem, string[]> = {
  question_id: ['question id', 'id', 'q#', 'q #', 'ref', 'reference id', 'question number', '#', 'qid'],
  question_text: ['question', 'question text', 'questions', 'description', 'control question', 'control'],
  response: ['response', 'answer', 'vendor response', 'response value', 'vendor answer'],
  response_type: ['response type', 'type', 'answer type'],
  evidence_text: ['evidence', 'evidence provided', 'supporting evidence', 'evidence description'],
  evidence_location: ['evidence location', 'reference', 'evidence reference', 'location', 'document reference'],
  vendor_comments: ['comments', 'vendor comments', 'notes', 'remarks', 'additional comments', 'comment'],
  relevant_date: ['date', 'relevant date', 'response date'],
  expiration_date: ['expiration date', 'expiry', 'expiry date', 'valid until', 'expiration', 'cert expiration'],
};

function normalizeKeyMap(row: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    map[key.trim().toLowerCase()] = key;
  }
  return map;
}

function pick(row: Record<string, unknown>, keyMap: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const original = keyMap[alias];
    if (original !== undefined) {
      const val = row[original];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val).trim();
      }
    }
  }
  return '';
}

function inferResponseType(explicit: string, response: string): ResponseType {
  const v = (explicit || response || '').trim().toLowerCase();
  if (v === 'yes' || v === 'y' || v.startsWith('yes')) return 'Yes';
  if (v === 'no' || v === 'n' || v.startsWith('no ') || v === 'no.') return 'No';
  if (v.startsWith('partial')) return 'Partial';
  if (v === 'n/a' || v === 'na' || v === 'not applicable' || v.startsWith('n/a')) return 'N/A';
  return 'FreeText';
}

export function parseRows(rows: Record<string, unknown>[]): NewQuestionnaireItem[] {
  const items: NewQuestionnaireItem[] = [];
  let seq = 0;
  for (const row of rows) {
    const keyMap = normalizeKeyMap(row);
    const question_text = pick(row, keyMap, ALIASES.question_text);
    const response = pick(row, keyMap, ALIASES.response);
    if (!question_text && !response) continue; // skip blank rows
    seq += 1;

    const explicitType = pick(row, keyMap, ALIASES.response_type);
    const question_id = pick(row, keyMap, ALIASES.question_id) || `Q${seq}`;

    items.push({
      question_id,
      question_text: question_text || '(no question text)',
      response,
      response_type: inferResponseType(explicitType, response),
      evidence_text: pick(row, keyMap, ALIASES.evidence_text) || null,
      evidence_location: pick(row, keyMap, ALIASES.evidence_location) || null,
      vendor_comments: pick(row, keyMap, ALIASES.vendor_comments) || null,
      relevant_date: pick(row, keyMap, ALIASES.relevant_date) || null,
      expiration_date: pick(row, keyMap, ALIASES.expiration_date) || null,
    });
  }
  return items;
}

function parseCellsFromHtml(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  for (const m of rowHtml.matchAll(cellRe)) {
    const text = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    cells.push(text);
  }
  return cells;
}

// Exported for unit testing — processes mammoth HTML output without calling mammoth.
export function parseDocxHtml(html: string): NewQuestionnaireItem[] {
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const trBlocks = [...html.matchAll(trRe)].map((m) => m[0]);

  if (trBlocks.length === 0) {
    throw new Error(
      'No parseable table found in Word document. Ensure the questionnaire uses a table with column headers.',
    );
  }

  const aliasedKeys = new Set<string>();
  for (const aliases of Object.values(ALIASES)) {
    for (const a of aliases) aliasedKeys.add(a);
  }

  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < trBlocks.length; i++) {
    const cells = parseCellsFromHtml(trBlocks[i]);
    if (cells.some((c) => aliasedKeys.has(c.toLowerCase().trim()))) {
      headerIdx = i;
      headers = cells;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error(
      'No parseable table found in Word document. Ensure the questionnaire uses a table with column headers.',
    );
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < trBlocks.length; i++) {
    const cells = parseCellsFromHtml(trBlocks[i]);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }

  const items = parseRows(rows);
  if (items.length === 0) {
    throw new Error(
      'No parseable table found in Word document. Ensure the questionnaire uses a table with column headers.',
    );
  }
  return items;
}

// Exported for unit testing — applies PDF text heuristics without calling pdf-parse.
export function parsePdfText(text: string): NewQuestionnaireItem[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Heuristic 1: tab-separated columns
  const tabLines = lines.filter((l) => l.includes('\t'));
  if (tabLines.length >= 3) {
    const headers = tabLines[0].split('\t').map((h) => h.trim());
    const rows: Record<string, unknown>[] = [];
    for (const line of tabLines.slice(1)) {
      const cells = line.split('\t');
      const row: Record<string, unknown> = {};
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = (cells[i] ?? '').trim();
      }
      rows.push(row);
    }
    const items = parseRows(rows);
    if (items.length > 0) return items;
  }

  // Heuristic 2: whitespace-aligned columns (2+ consecutive spaces)
  const splitLines = lines.map((l) => l.split(/\s{2,}/));
  const multiColLines = splitLines.filter((cols) => cols.length >= 2);
  if (multiColLines.length >= 3) {
    const colCount = multiColLines[0].length;
    const consistent = multiColLines.filter((cols) => cols.length === colCount);
    if (consistent.length >= 3) {
      const headers = consistent[0];
      const rows: Record<string, unknown>[] = [];
      for (const cols of consistent.slice(1)) {
        const row: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
          row[headers[i]] = (cols[i] ?? '').trim();
        }
        rows.push(row);
      }
      const items = parseRows(rows);
      if (items.length > 0) return items;
    }
  }

  throw new Error(
    'Could not detect table structure in PDF. For reliable parsing, export the questionnaire as .xlsx or .docx.',
  );
}

export async function parseDocxQuestionnaire(buffer: Buffer): Promise<NewQuestionnaireItem[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return parseDocxHtml(html);
}

export async function parsePdfQuestionnaire(buffer: Buffer): Promise<NewQuestionnaireItem[]> {
  const { text } = await pdfParse(buffer);
  return parsePdfText(text);
}

const SAFE_UPLOAD_ROOT = resolve(process.cwd(), 'server', 'uploads');

function ensurePathWithinUploads(filePath: string): string {
  const root = normalize(resolve(SAFE_UPLOAD_ROOT));
  const resolvedPath = normalize(resolve(filePath));
  if (resolvedPath !== root && !resolvedPath.startsWith(root + sep)) {
    throw new Error('Invalid upload file path');
  }
  return resolvedPath;
}

export async function parseQuestionnaire(filePath: string, originalName: string): Promise<NewQuestionnaireItem[]> {
  const safePath = ensurePathWithinUploads(filePath);
  const buf = await readFile(safePath);
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf') return parsePdfQuestionnaire(buf);
  if (ext === 'docx' || ext === 'doc') return parseDocxQuestionnaire(buf);

  // Default: XLSX / XLS / XLSM / CSV
  // (XLSX.read is kept sync inside the now-async wrapper — no behaviour change)
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return parseRows(rows);
}
