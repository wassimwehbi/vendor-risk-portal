import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopeFor } from './_scope';

// Use an isolated temp DB so this does not touch the dev database.
process.env.VRP_DB_PATH = join(tmpdir(), `vrp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

// Dynamic imports AFTER setting VRP_DB_PATH so db.ts opens the temp file.
const { createAssessment, replaceItems, patchAssessment, getAssessment } = await import('../src/services/store');
const { analyzeAssessment } = await import('../src/services/aiEngine');
const { createTenant } = await import('../src/services/tenantStore');
const { getScenario } = await import('../src/data/scenarios/index');

const tenant = createTenant('Acme');
const scope = scopeFor({ actor: 'tester', tenantId: tenant.id, role: 'Analyst' });

function newAssessment() {
  const a = createAssessment(
    { vendor_name: `Vendor ${Math.random()}`, questionnaire_type: 'SIG', date_submitted: '2026-05-24' },
    scope,
  );
  replaceItems(a.id, getScenario('securehealth')!.items, scope);
  return a.id;
}

test('re-running analysis resets a prior approval to pending', async () => {
  const id = newAssessment();
  await analyzeAssessment(id, scope);
  patchAssessment(id, { validation_status: 'approved' }, scope);

  let a = getAssessment(id, scope)!;
  assert.equal(a.validation_status, 'approved');
  assert.equal(a.validated_by, 'tester');
  assert.equal(a.status, 'approved');

  // Re-analyze -> approval must be invalidated.
  await analyzeAssessment(id, scope);
  a = getAssessment(id, scope)!;
  assert.equal(a.validation_status, 'pending');
  assert.equal(a.validated_by, null);
  assert.equal(a.status, 'analyzed');
});

test('re-extracting items resets a prior approval to pending', async () => {
  const id = newAssessment();
  await analyzeAssessment(id, scope);
  patchAssessment(id, { validation_status: 'approved' }, scope);
  assert.equal(getAssessment(id, scope)!.validation_status, 'approved');

  // Re-upload / re-extract -> approval must be invalidated and findings cleared.
  replaceItems(id, getScenario('dataflow')!.items, scope);
  const a = getAssessment(id, scope)!;
  assert.equal(a.validation_status, 'pending');
  assert.equal(a.validated_by, null);
  assert.equal(a.status, 'extracted');
  assert.equal(a.overall_risk, null);
  assert.equal(a.finding_count, 0);
});
