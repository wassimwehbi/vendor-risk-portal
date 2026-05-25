import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRows } from '../src/services/extraction';

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
  const rows = [
    { ID: '7', 'question text': 'Encryption at rest?', Answer: 'No', Notes: 'planned' },
  ];
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
