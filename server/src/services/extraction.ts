import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { NewQuestionnaireItem, ResponseType } from '../types';

/**
 * Parses an uploaded SIG questionnaire (.xlsx / .xls / .csv) into structured
 * questionnaire items. Column headers are matched case-insensitively using the
 * alias sets below, so a variety of SIG-style exports are supported.
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

export function parseQuestionnaire(filePath: string, _originalName: string): NewQuestionnaireItem[] {
  // Read into a buffer and use XLSX.read (XLSX.readFile is unavailable under ESM
  // because it depends on a runtime require('fs')).
  const buf = readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return parseRows(rows);
}
