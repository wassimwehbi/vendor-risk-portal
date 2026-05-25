import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use an isolated temp DB so this does not touch the dev database.
process.env.VRP_DB_PATH = join(tmpdir(), `vrp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

// Dynamic imports AFTER setting VRP_DB_PATH so db.ts opens the temp file.
const { createAssessment, replaceItems, patchAssessment, getAssessment } = await import('../src/services/store');
const { analyzeAssessment } = await import('../src/services/aiEngine');
const { getScenario } = await import('../src/data/scenarios/index');

function newApprovedAssessment() {
  const a = createAssessment(
    { vendor_name: `Vendor ${Math.random()}`, questionnaire_type: 'SIG', date_submitted: '2026-05-24' },
    'tester',
    'Analyst',
  );
  replaceItems(a.id, getScenario('securehealth')!.items, 'tester', 'Analyst');
  return a.id;
}

test('re-running analysis resets a prior approval to pending', async () => {
  const id = newApprovedAssessment();
  await analyzeAssessment(id, 'tester', 'Analyst');
  patchAssessment(id, { validation_status: 'approved' }, 'tester', 'Analyst');

  let a = getAssessment(id)!;
  assert.equal(a.validation_status, 'approved');
  assert.equal(a.validated_by, 'tester');
  assert.equal(a.status, 'approved');

  // Re-analyze -> approval must be invalidated.
  await analyzeAssessment(id, 'tester', 'Analyst');
  a = getAssessment(id)!;
  assert.equal(a.validation_status, 'pending');
  assert.equal(a.validated_by, null);
  assert.equal(a.status, 'analyzed');
});

test('re-extracting items resets a prior approval to pending', async () => {
  const id = newApprovedAssessment();
  await analyzeAssessment(id, 'tester', 'Analyst');
  patchAssessment(id, { validation_status: 'approved' }, 'tester', 'Analyst');
  assert.equal(getAssessment(id)!.validation_status, 'approved');

  // Re-upload / re-extract -> approval must be invalidated and findings cleared.
  replaceItems(id, getScenario('dataflow')!.items, 'tester', 'Analyst');
  const a = getAssessment(id)!;
  assert.equal(a.validation_status, 'pending');
  assert.equal(a.validated_by, null);
  assert.equal(a.status, 'extracted');
  assert.equal(a.overall_risk, null);
  assert.equal(a.finding_count, 0);
});
