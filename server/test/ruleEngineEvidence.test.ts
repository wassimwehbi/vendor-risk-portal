import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessEvidence, detectDataCategories, ruleEngine } from '../src/services/ruleEngine';
import type { EvidenceContext, QuestionnaireItem } from '../src/types';

function makeItem(overrides: Partial<QuestionnaireItem> = {}): QuestionnaireItem {
  return {
    id: 1,
    assessment_id: 1,
    question_id: 'Q1',
    question_text: 'Do you perform penetration testing?',
    response: 'Yes, we conduct annual penetration tests.',
    response_type: 'Yes',
    evidence_text: 'See attached audit report',
    evidence_location: null,
    vendor_comments: null,
    relevant_date: null,
    expiration_date: null,
    ...overrides,
  };
}

const SOC2_EVIDENCE: EvidenceContext[] = [
  {
    name: 'SOC2-Report-2024.pdf',
    kind: 'pdf',
    text: 'SOC 2 Type II report for the period ending December 31 2024. In our opinion the controls were suitably designed and operating effectively.',
  },
];

const POLICY_ONLY_EVIDENCE: EvidenceContext[] = [
  {
    name: 'InfoSec-Policy.pdf',
    kind: 'pdf',
    text: 'This policy outlines our security policies and policies for data handling. All employees must follow these policies.',
  },
];

test('soc 2 type ii in document text upgrades evidence_sufficiency to Sufficient', () => {
  // Without document, this item would get Insufficient (vague "industry-standard" language)
  const item = makeItem({ response: 'We follow industry-standard security practices.' });
  const result = assessEvidence(item, 'we follow industry-standard security practices.', 'Weak', SOC2_EVIDENCE);
  assert.equal(result, 'Sufficient');
});

test('evidence document with only policy text stays Insufficient', () => {
  const item = makeItem();
  const result = assessEvidence(item, 'yes we conduct annual penetration tests.', 'Strong', POLICY_ONLY_EVIDENCE);
  assert.equal(result, 'Insufficient');
});

test('no evidence context falls back to existing behavior (returns None when no metadata)', () => {
  const item = makeItem({ evidence_text: null, evidence_location: null });
  const result = assessEvidence(item, 'yes we conduct annual penetration tests.', 'Strong', undefined);
  assert.equal(result, 'None');
});

test('no evidence context falls back to existing behavior (returns Sufficient with metadata)', () => {
  const item = makeItem({ evidence_text: 'audit report 2024', evidence_location: null });
  const result = assessEvidence(item, 'yes we conduct annual penetration tests.', 'Strong', undefined);
  assert.equal(result, 'Sufficient');
});

test('expiration check takes precedence over document content', () => {
  const pastDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const item = makeItem({ expiration_date: pastDate });
  const result = assessEvidence(item, 'yes', 'Strong', SOC2_EVIDENCE);
  assert.equal(result, 'Expired');
});

test('detectDataCategories picks up PHI terms in document text', () => {
  const docText = 'This report covers protected health information and ePHI handling procedures.';
  const categories = detectDataCategories(docText);
  assert.ok(categories.includes('phi'), `expected 'phi' in ${JSON.stringify(categories)}`);
});

test('analyzeItem data_categories includes PHI from evidence text absent in item fields', async () => {
  const item = makeItem({
    question_text: 'Describe your backup procedures.',
    response: 'We back up all data nightly.',
    evidence_text: null,
    evidence_location: null,
  });
  const evidence: EvidenceContext[] = [
    {
      name: 'backup-scope.pdf',
      kind: 'pdf',
      text: 'Backup scope includes protected health information and patient records stored in the PHI vault.',
    },
  ];
  const result = await ruleEngine.analyzeItem(item, evidence);
  assert.ok(result.data_categories.includes('phi'), `expected 'phi' in ${JSON.stringify(result.data_categories)}`);
});

test('iso 27001 in document text is a concrete signal for Sufficient', () => {
  const evidence: EvidenceContext[] = [
    {
      name: 'ISO-Cert.pdf',
      kind: 'pdf',
      text: 'ISO 27001 certificate number GB-12345 valid until 2025-12-31.',
    },
  ];
  const item = makeItem({ evidence_text: 'certificate attached' });
  const result = assessEvidence(item, 'yes iso 27001 certified.', 'Strong', evidence);
  assert.equal(result, 'Sufficient');
});

test('buildEvidenceBlock: long document is truncated in analyzeItem evidence param (no crash)', async () => {
  const longText = 'a'.repeat(10_000);
  const evidence: EvidenceContext[] = [{ name: 'big.pdf', kind: 'pdf', text: longText }];
  const item = makeItem({ evidence_text: null, evidence_location: null });
  // Just verify it completes without throwing
  const result = await ruleEngine.analyzeItem(item, evidence);
  assert.ok(result.control_domain);
});
