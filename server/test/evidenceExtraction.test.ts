import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { classifyEvidence, isAllowedEvidence, extractEvidence } from '../src/services/evidenceExtraction';

const dir = mkdtempSync(join(tmpdir(), 'vrp-ev-'));

function tmp(name: string, data: Buffer | string): string {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

test('classifyEvidence recognises the supported types', () => {
  assert.equal(classifyEvidence('report.pdf', 'application/pdf'), 'pdf');
  assert.equal(classifyEvidence('policy.docx', ''), 'word');
  assert.equal(classifyEvidence('legacy.doc', ''), 'word');
  assert.equal(classifyEvidence('matrix.xlsx', ''), 'excel');
  assert.equal(classifyEvidence('export.csv', 'text/csv'), 'csv');
  assert.equal(classifyEvidence('screenshot.png', 'image/png'), 'image');
  // MIME fallback when the extension is missing/unknown
  assert.equal(classifyEvidence('blob', 'application/pdf'), 'pdf');
});

test('classifyEvidence rejects unsupported types', () => {
  assert.equal(classifyEvidence('malware.exe', 'application/octet-stream'), null);
  assert.equal(classifyEvidence('archive.zip', 'application/zip'), null);
  assert.equal(isAllowedEvidence('notes.txt', 'text/plain'), false);
});

test('extracts text from a CSV evidence file', async () => {
  const p = tmp('evidence.csv', 'Control,Status\nSOC 2 Type II,valid through 2026\nAES-256,enabled\n');
  const r = await extractEvidence(p, 'evidence.csv', 'text/csv');
  assert.equal(r.kind, 'csv');
  assert.equal(r.status, 'extracted');
  assert.ok(r.text.includes('SOC 2 Type II'), 'expected CSV content in extracted text');
  assert.ok(r.chars > 0);
});

test('extracts text from an Excel evidence file', async () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Control', 'Evidence'],
    ['Encryption at rest', 'AES-256 enabled'],
    ['MFA', 'Enforced for all users'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Controls');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const p = tmp('matrix.xlsx', buf);
  const r = await extractEvidence(
    p,
    'matrix.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  assert.equal(r.kind, 'excel');
  assert.equal(r.status, 'extracted');
  assert.ok(r.text.includes('AES-256 enabled'));
});

test('recognises an image but performs no text extraction (no_text)', async () => {
  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const p = tmp('shot.png', png);
  const r = await extractEvidence(p, 'shot.png', 'image/png');
  assert.equal(r.kind, 'image');
  assert.equal(r.status, 'no_text');
  assert.equal(r.text, '');
  assert.ok(r.note && /1×1|image/i.test(r.note));
});

test('legacy .doc is accepted as a type but reported unsupported for extraction', async () => {
  const p = tmp('old.doc', Buffer.from('legacy binary doc'));
  const r = await extractEvidence(p, 'old.doc', 'application/msword');
  assert.equal(r.kind, 'word');
  assert.equal(r.status, 'unsupported');
});

test('unsupported file type is reported as such', async () => {
  const p = tmp('notes.txt', 'hello');
  const r = await extractEvidence(p, 'notes.txt', 'text/plain');
  assert.equal(r.kind, 'unknown');
  assert.equal(r.status, 'unsupported');
});
