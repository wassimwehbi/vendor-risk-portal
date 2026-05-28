import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { parseRows, parseDocxHtml, parsePdfText, parseQuestionnaire } from '../src/services/extraction';

// parseQuestionnaire enforces that files live under server/uploads, so write fixtures there.
const UPLOADS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

test('maps standard SIG-style columns', () => {
  const rows = [
    {
      'Question ID': 'C1',
      Question: 'Do you enforce MFA for privileged users?',
      Response: 'Yes',
      'Response Type': 'Yes',
      Evidence: 'Access Control Policy',
      'Evidence Location': 'page 4',
      Comments: 'Enforced via IdP',
      'Expiration Date': '2027-01-01',
    },
  ];
  const items = parseRows(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].question_id, 'C1');
  assert.equal(items[0].response_type, 'Yes');
  assert.equal(items[0].evidence_text, 'Access Control Policy');
  assert.equal(items[0].evidence_location, 'page 4');
  assert.equal(items[0].expiration_date, '2027-01-01');
});

test('matches header aliases case-insensitively', () => {
  const rows = [{ ID: '7', 'question text': 'Encryption at rest?', Answer: 'No', Notes: 'planned' }];
  const items = parseRows(rows);
  assert.equal(items[0].question_id, '7');
  assert.equal(items[0].question_text, 'Encryption at rest?');
  assert.equal(items[0].response, 'No');
  assert.equal(items[0].response_type, 'No');
  assert.equal(items[0].vendor_comments, 'planned');
});

test('infers response type from response when no type column', () => {
  const rows = [
    { Question: 'Partial coverage?', Response: 'Partially implemented' },
    { Question: 'Applicable?', Response: 'N/A' },
    { Question: 'Free text?', Response: 'We use a SIEM and rotate keys.' },
  ];
  const items = parseRows(rows);
  assert.equal(items[0].response_type, 'Partial');
  assert.equal(items[1].response_type, 'N/A');
  assert.equal(items[2].response_type, 'FreeText');
});

test('auto-generates question ids and skips blank rows', () => {
  const rows = [
    { Question: 'First?', Response: 'Yes' },
    { Question: '', Response: '' },
    { Question: 'Third?', Response: 'No' },
  ];
  const items = parseRows(rows);
  assert.equal(items.length, 2);
  assert.equal(items[0].question_id, 'Q1');
  assert.equal(items[1].question_id, 'Q2');
});

// ---- DOCX HTML parser tests ----

test('parseDocxHtml extracts items from a minimal HTML table', () => {
  const html = `<table>
    <tr><td>Question ID</td><td>Question</td><td>Response</td></tr>
    <tr><td>1</td><td>Do you use MFA?</td><td>Yes</td></tr>
    <tr><td>2</td><td>Is data encrypted?</td><td>Yes</td></tr>
  </table>`;
  const items = parseDocxHtml(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].question_id, '1');
  assert.equal(items[0].question_text, 'Do you use MFA?');
  assert.equal(items[0].response_type, 'Yes');
  assert.equal(items[1].question_id, '2');
});

test('parseDocxHtml handles mammoth <p>-wrapped cell content', () => {
  const html = `<table>
    <tr><td><p>Question</p></td><td><p>Vendor Answer</p></td></tr>
    <tr><td><p>Is antivirus deployed?</p></td><td><p>No</p></td></tr>
  </table>`;
  const items = parseDocxHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].question_text, 'Is antivirus deployed?');
  assert.equal(items[0].response, 'No');
  assert.equal(items[0].response_type, 'No');
});

test('parseDocxHtml matches aliased header "Vendor Answer"', () => {
  const html = `<table>
    <tr><th>ID</th><th>Question Text</th><th>Vendor Answer</th><th>Evidence</th></tr>
    <tr><td>A1</td><td>MFA enforced?</td><td>Yes</td><td>Policy doc</td></tr>
  </table>`;
  const items = parseDocxHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].question_id, 'A1');
  assert.equal(items[0].response, 'Yes');
  assert.equal(items[0].evidence_text, 'Policy doc');
});

test('parseDocxHtml uses first table with recognized headers when multiple tables exist', () => {
  const html = `<table>
    <tr><td>Name</td><td>Value</td></tr>
    <tr><td>Vendor</td><td>ACME</td></tr>
  </table>
  <table>
    <tr><td>Question ID</td><td>Question</td><td>Response</td></tr>
    <tr><td>Q1</td><td>Encrypted storage?</td><td>Yes</td></tr>
  </table>`;
  const items = parseDocxHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].question_id, 'Q1');
});

test('parseDocxHtml ignores rows from a non-questionnaire table that follows', () => {
  const html = `<table>
    <tr><td>Question ID</td><td>Question</td><td>Response</td></tr>
    <tr><td>Q1</td><td>Encrypted storage?</td><td>Yes</td></tr>
  </table>
  <table>
    <tr><td>Name</td><td>Value</td></tr>
    <tr><td>Contact</td><td>ops@acme.com</td></tr>
  </table>`;
  const items = parseDocxHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].question_id, 'Q1');
});

test('parseDocxHtml throws when no table is present', () => {
  assert.throws(() => parseDocxHtml('<p>Some plain text</p>'), /No parseable table found/);
});

test('parseDocxHtml throws when table has no recognized header', () => {
  const html = `<table>
    <tr><td>Foo</td><td>Bar</td><td>Baz</td></tr>
    <tr><td>1</td><td>2</td><td>3</td></tr>
  </table>`;
  assert.throws(() => parseDocxHtml(html), /No parseable table found/);
});

// ---- PDF text parser tests ----

test('parsePdfText extracts items from tab-separated content', () => {
  const text = [
    'Question ID\tQuestion\tResponse',
    'Q1\tDo you use MFA?\tYes',
    'Q2\tIs data encrypted at rest?\tNo',
    'Q3\tAre audits performed?\tPartially',
  ].join('\n');
  const items = parsePdfText(text);
  assert.equal(items.length, 3);
  assert.equal(items[0].question_id, 'Q1');
  assert.equal(items[0].response_type, 'Yes');
  assert.equal(items[1].response_type, 'No');
  assert.equal(items[2].response_type, 'Partial');
});

test('parsePdfText extracts items from multi-space-aligned content', () => {
  const text = [
    'Question ID  Question                    Response',
    'Q1           Do you use MFA?             Yes',
    'Q2           Is data encrypted at rest?  No',
    'Q3           Are audits performed?       Partially',
  ].join('\n');
  const items = parsePdfText(text);
  assert.ok(items.length >= 1, 'should extract at least one item');
  assert.equal(items[0].response_type, 'Yes');
});

test('parsePdfText throws descriptive error when no structure found', () => {
  const text = 'This is a scanned PDF with no recognisable table structure.';
  assert.throws(() => parsePdfText(text), /Could not detect table structure/);
});

test('parsePdfText throws when fewer than 3 tab lines', () => {
  const text = 'Q1\tQuestion\tYes\nQ2\tOther\tNo';
  assert.throws(() => parsePdfText(text), /Could not detect table structure/);
});

// ---- parseQuestionnaire dispatcher tests ----

test('parseQuestionnaire dispatches to XLSX path for .xlsx extension', async () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { Question: 'Is MFA enabled?', Response: 'Yes' },
    { Question: 'Is data encrypted?', Response: 'No' },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  await mkdir(UPLOADS_DIR, { recursive: true });
  const tmpPath = join(UPLOADS_DIR, `vrp-test-${Date.now()}.xlsx`);
  await writeFile(tmpPath, buf);
  try {
    const items = await parseQuestionnaire(tmpPath, 'questionnaire.xlsx');
    assert.equal(items.length, 2);
    assert.equal(items[0].response_type, 'Yes');
    assert.equal(items[1].response_type, 'No');
  } finally {
    await rm(tmpPath, { force: true });
  }
});

test('parseQuestionnaire dispatches to XLSX path for .csv extension', async () => {
  const csv = 'Question,Response\nIs backup tested?,Yes\n';
  await mkdir(UPLOADS_DIR, { recursive: true });
  const tmpPath = join(UPLOADS_DIR, `vrp-test-${Date.now()}.csv`);
  await writeFile(tmpPath, csv);
  try {
    const items = await parseQuestionnaire(tmpPath, 'questionnaire.csv');
    assert.equal(items.length, 1);
    assert.equal(items[0].response_type, 'Yes');
  } finally {
    await rm(tmpPath, { force: true });
  }
});

test('parseQuestionnaire dispatches to PDF path for .pdf extension and surfaces PDF error', async () => {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const tmpPath = join(UPLOADS_DIR, `vrp-test-${Date.now()}.pdf`);
  await writeFile(tmpPath, Buffer.from('not a real pdf'));
  try {
    await assert.rejects(parseQuestionnaire(tmpPath, 'questionnaire.pdf'));
  } finally {
    await rm(tmpPath, { force: true });
  }
});

test('parseQuestionnaire dispatches to DOCX path for .docx extension and surfaces DOCX error', async () => {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const tmpPath = join(UPLOADS_DIR, `vrp-test-${Date.now()}.docx`);
  await writeFile(tmpPath, Buffer.from('not a real docx'));
  try {
    await assert.rejects(parseQuestionnaire(tmpPath, 'questionnaire.docx'));
  } finally {
    await rm(tmpPath, { force: true });
  }
});
