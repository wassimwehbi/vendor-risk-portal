import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopeFor } from './_scope';

process.env.VRP_DB_PATH = join(tmpdir(), `vrp-tenancy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const store = await import('../src/services/store');
const { analyzeAssessment } = await import('../src/services/aiEngine');
const { createTenant } = await import('../src/services/tenantStore');
const { getScenario } = await import('../src/data/scenarios/index');

const tA = createTenant('Tenant A');
const tB = createTenant('Tenant B');

const analystA = scopeFor({ actor: 'analyst@a.com', tenantId: tA.id, role: 'Analyst' });
const analystB = scopeFor({ actor: 'analyst@b.com', tenantId: tB.id, role: 'Analyst' });
const sub1 = scopeFor({ actor: 's1@a.com', tenantId: tA.id, role: 'Submitter' });
const sub2 = scopeFor({ actor: 's2@a.com', tenantId: tA.id, role: 'Submitter' });
const admin = scopeFor({ actor: 'admin@x.com', tenantId: null, role: 'Admin' });

function mkAssessment(scope: ReturnType<typeof scopeFor>, vendor = `V${Math.random()}`) {
  const a = store.createAssessment(
    { vendor_name: vendor, questionnaire_type: 'SIG', date_submitted: '2026-05-24' },
    scope,
  );
  store.replaceItems(a.id, getScenario('securehealth')!.items, scope);
  return a.id;
}

test('assessments are isolated by tenant', () => {
  const aId = mkAssessment(analystA, 'Acme A');
  const bId = mkAssessment(analystB, 'Acme B');

  const listA = store.listAssessments(analystA).map((x) => x.id);
  assert.ok(listA.includes(aId));
  assert.ok(!listA.includes(bId), 'tenant A must not see tenant B assessments');

  // Cross-tenant get returns undefined (-> 404 at the route, no existence leak).
  assert.equal(store.getAssessment(bId, analystA), undefined);
  assert.equal(store.getAssessment(aId, analystB), undefined);

  // Admin in all-tenants mode sees both.
  const adminIds = store.listAssessments(admin).map((x) => x.id);
  assert.ok(adminIds.includes(aId) && adminIds.includes(bId));
});

test('submitters only see their own submissions', () => {
  const ownId = mkAssessment(sub1, 'Sub1 Vendor');

  // A different submitter in the same tenant cannot see it.
  assert.equal(store.getAssessment(ownId, sub2), undefined);
  assert.ok(
    !store
      .listAssessments(sub2)
      .map((x) => x.id)
      .includes(ownId),
  );

  // The owner sees it; an analyst in the same tenant sees it.
  assert.ok(store.getAssessment(ownId, sub1));
  assert.ok(store.getAssessment(ownId, analystA));
});

test('cross-tenant mutations are rejected (IDOR closed)', async () => {
  const aId = mkAssessment(analystA, 'IDOR Vendor');
  await analyzeAssessment(aId, analystA);
  const detail = store.getAssessmentDetail(aId, analystA)!;
  const findingId = detail.findings[0].id;

  // Analyst in tenant B cannot patch tenant A's finding or assessment.
  assert.equal(store.patchFinding(findingId, { risk_level: 'Low' }, analystB), undefined);
  assert.equal(store.patchAssessment(aId, { analyst_notes: 'tampered' }, analystB), undefined);

  // The legitimate analyst still can.
  assert.ok(store.patchFinding(findingId, { risk_level: 'Low' }, analystA));
  assert.ok(store.patchAssessment(aId, { analyst_notes: 'ok' }, analystA));
});

test('creating an assessment requires a concrete tenant (admin must pick one)', () => {
  // A brand-new record has no assessment to infer a tenant from, so an admin in
  // all-tenants mode must still pin a tenant before creating.
  assert.throws(
    () => store.createAssessment({ vendor_name: 'X', questionnaire_type: 'SIG', date_submitted: '2026-05-24' }, admin),
    /Select a tenant/,
  );
});

test('admin in all-tenants mode can write to an existing assessment', async () => {
  // Tenant Analyst creates + analyzes an assessment in tenant A.
  const aId = mkAssessment(analystA, 'AllTenants Vendor');
  await analyzeAssessment(aId, analystA);
  const findingId = store.getAssessmentDetail(aId, analystA)!.findings[0].id;

  // The admin's default session is all-tenants (activeTenantId === null).
  const adminScope = scopeFor({ actor: 'admin@x.com', tenantId: null, role: 'Admin' });

  // Re-analyze, edit, and override findings all succeed despite no pinned tenant.
  const reanalyzed = await analyzeAssessment(aId, adminScope);
  assert.ok(reanalyzed, 'admin can re-analyze an existing assessment cross-tenant');

  const patched = store.patchAssessment(aId, { analyst_notes: 'reviewed by global admin' }, adminScope);
  assert.ok(patched, 'admin can edit an existing assessment cross-tenant');
  assert.equal(patched!.analyst_notes, 'reviewed by global admin');
  assert.equal(patched!.tenant_id, tA.id, 'assessment stays in its original tenant');

  const newFindingId = store.getAssessmentDetail(aId, adminScope)!.findings[0].id;
  const overridden = store.patchFinding(newFindingId, { risk_level: 'Low' }, adminScope);
  assert.ok(overridden, 'admin can override a finding cross-tenant');

  // The audit trail stays stamped with the original tenant, not null.
  const audit = store.listAudit(aId);
  assert.ok(audit.length > 0);
  assert.ok(
    audit.every((e) => e.tenant_id === tA.id),
    'audit entries keep the original tenant',
  );
});
