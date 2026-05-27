import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopeFor } from './_scope';

process.env.VRP_DB_PATH = join(tmpdir(), `vrp-admindel-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const ts = await import('../src/services/tenantStore');
const auth = await import('../src/services/auth');
const inv = await import('../src/services/invites');
const store = await import('../src/services/store');
const { db } = await import('../src/db');

test('countAssessmentsForTenant reflects assessments', () => {
  const t = ts.createTenant('HasData');
  store.createAssessment(
    { vendor_name: 'V', questionnaire_type: 'SIG', date_submitted: '2026-05-25' },
    scopeFor({ actor: 'a@x.com', tenantId: t.id, role: 'Analyst' }),
  );
  assert.equal(ts.countAssessmentsForTenant(t.id), 1);
});

test('deleteEmptyTenant clears memberships + invites; tenant gone', () => {
  const t = ts.createTenant('ToDelete');
  const u = auth.upsertUserOnLogin({ email: 'm@x.com' });
  ts.setMembership(u.id, t.id, 'Analyst');
  inv.createInvite({ email: 'p@x.com', tenantId: t.id, role: 'Viewer', invitedBy: 'admin@x.com' });

  assert.equal(ts.countAssessmentsForTenant(t.id), 0);
  ts.deleteEmptyTenant(t.id);

  assert.equal(ts.getTenant(t.id), undefined);
  assert.equal(auth.getMembershipsForUser(u.id).length, 0);
  assert.ok(!inv.listPendingInvites().some((i) => i.tenant_id === t.id));
});

test('deleteAssessment returns false for a non-existent id', () => {
  const adminScope = scopeFor({ actor: 'admin@x.com', tenantId: null, role: 'Admin', isAdmin: true });
  assert.equal(store.deleteAssessment(999999, adminScope), false);
});

test('deleteAssessment removes the assessment and cascades to dependent rows', () => {
  const t = ts.createTenant('ADelTenant');
  const adminScope = scopeFor({ actor: 'admin@x.com', tenantId: t.id, role: 'Admin' });

  const a = store.createAssessment(
    { vendor_name: 'ADelVendor', questionnaire_type: 'SIG', date_submitted: '2026-05-25' },
    adminScope,
  );

  assert.equal(store.deleteAssessment(a.id, adminScope), true);

  assert.equal(store.getAssessment(a.id, adminScope), undefined);
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE assessment_id = ?`).get(a.id) as { n: number }).n;
  assert.equal(count('findings'), 0);
  assert.equal(count('questionnaire_items'), 0);
  assert.equal(count('evidence_files'), 0);
  assert.equal(count('audit_log'), 0);
});

test('deleteAssessment records an assessment_deleted audit entry', () => {
  const t = ts.createTenant('AuditDelTenant');
  const adminScope = scopeFor({ actor: 'admin@x.com', tenantId: t.id, role: 'Admin' });

  const a = store.createAssessment(
    { vendor_name: 'AuditDelVendor', questionnaire_type: 'SIG', date_submitted: '2026-05-25' },
    adminScope,
  );

  store.deleteAssessment(a.id, adminScope);

  const entry = db
    .prepare("SELECT * FROM audit_log WHERE action = 'assessment_deleted' AND tenant_id = ? ORDER BY id DESC LIMIT 1")
    .get(t.id) as { assessment_id: number; details: string } | undefined;
  assert.ok(entry, 'deletion audit entry exists');
  assert.equal(entry.assessment_id, 0);
  assert.equal(JSON.parse(entry.details).assessment_id, a.id);
});

test('deleteUser removes memberships + pending invites; authored assessment retained', () => {
  const t = ts.createTenant('UserDel');
  const u = auth.upsertUserOnLogin({ email: 'gone@x.com' });
  ts.setMembership(u.id, t.id, 'Submitter');
  inv.createInvite({ email: 'gone@x.com', tenantId: t.id, role: 'Viewer', invitedBy: 'admin@x.com' });

  const a = store.createAssessment(
    { vendor_name: 'W', questionnaire_type: 'SIG', date_submitted: '2026-05-25' },
    scopeFor({ actor: 'gone@x.com', userId: u.id, tenantId: t.id, role: 'Submitter' }),
  );

  ts.deleteUser(u.id);

  assert.equal(ts.getAdminUser(u.id), undefined);
  assert.equal(auth.getMembershipsForUser(u.id).length, 0);
  assert.ok(!inv.listPendingInvites().some((i) => i.email === 'gone@x.com'));
  // The authored assessment survives (created_by is just a label).
  assert.ok(store.getAssessment(a.id, scopeFor({ actor: 'admin', tenantId: t.id, role: 'Admin' })));
});
