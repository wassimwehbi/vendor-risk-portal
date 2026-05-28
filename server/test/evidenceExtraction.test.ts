import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { classifyEvidence, isAllowedEvidence, extractEvidence, _testHooks } from '../src/services/evidenceExtraction';

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

// 1x1 PNG used across image tests
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('image falls back to no_text when ANTHROPIC_API_KEY is absent', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const p = tmp('shot.png', PNG_1X1);
  const r = await extractEvidence(p, 'shot.png', 'image/png');
  assert.equal(r.kind, 'image');
  assert.equal(r.status, 'no_text');
  assert.equal(r.text, '');
  assert.ok(r.note && /1×1|image/i.test(r.note));
  if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
});

test('BMP image falls back to no_text (unsupported MIME for vision)', async () => {
  // Keep a real API key so only the MIME guard — not the "no key" guard — is responsible for the fallback.
  process.env.ANTHROPIC_API_KEY = 'dummy-test-key';
  let visionCalled = false;
  _testHooks.createAnthropicClient = () => ({
    messages: {
      create: async () => {
        visionCalled = true;
        return { content: [] };
      },
    },
  });
  const p = tmp('shot.bmp', PNG_1X1);
  const r = await extractEvidence(p, 'shot.bmp', 'image/bmp');
  _testHooks.createAnthropicClient = null;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(r.kind, 'image');
  assert.equal(r.status, 'no_text');
  assert.ok(!visionCalled, 'vision client must not be called for unsupported MIME');
});

test('image vision skips oversized images and falls back to no_text', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  // Buffer just over the 3.75 MB cap
  const big = Buffer.alloc(3_750_001, 0);
  const p = tmp('big.png', big);
  const r = await extractEvidence(p, 'big.png', 'image/png');
  assert.equal(r.kind, 'image');
  assert.equal(r.status, 'no_text');
  delete process.env.ANTHROPIC_API_KEY;
});

test('SVG image yields extracted SVG markup', async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
  );
  const p = tmp('diagram.svg', svg);
  const r = await extractEvidence(p, 'diagram.svg', 'image/svg+xml');
  assert.equal(r.kind, 'image');
  assert.equal(r.status, 'extracted');
  assert.ok(r.text.includes('<svg'));
  assert.ok(r.chars > 0);
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
