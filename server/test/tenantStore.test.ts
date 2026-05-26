import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VRP_DB_PATH = join(tmpdir(), `vrp-tenantstore-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const ts = await import('../src/services/tenantStore');
const auth = await import('../src/services/auth');

test('createTenant generates unique slugs', () => {
  const a = ts.createTenant('Acme Corp');
  const b = ts.createTenant('Acme Corp');
  assert.equal(a.slug, 'acme-corp');
  assert.notEqual(a.slug, b.slug);
});

test('memberships: per-tenant roles, upsert, removal', () => {
  const tA = ts.createTenant('Alpha');
  const tB = ts.createTenant('Beta');
  const user = auth.upsertUserOnLogin({ email: 'multi@x.com' });

  ts.setMembership(user.id, tA.id, 'Analyst');
  ts.setMembership(user.id, tB.id, 'Submitter');
  let mems = auth.getMembershipsForUser(user.id);
  assert.equal(mems.length, 2);
  assert.equal(mems.find((m) => m.tenant_id === tA.id)?.role, 'Analyst');
  assert.equal(mems.find((m) => m.tenant_id === tB.id)?.role, 'Submitter');

  // Upsert changes the role instead of duplicating.
  ts.setMembership(user.id, tA.id, 'Viewer');
  mems = auth.getMembershipsForUser(user.id);
  assert.equal(mems.length, 2);
  assert.equal(mems.find((m) => m.tenant_id === tA.id)?.role, 'Viewer');

  // buildSessionUser resolves the active tenant per the preferred membership.
  assert.equal(auth.buildSessionUser(user, tB.id).activeTenantId, tB.id);
  assert.equal(auth.buildSessionUser(user, tA.id).activeTenantId, tA.id);

  assert.equal(ts.removeMembership(user.id, tB.id), true);
  assert.equal(auth.getMembershipsForUser(user.id).length, 1);
});

test('global admin flag + last-admin count', () => {
  const u = auth.upsertUserOnLogin({ email: 'admin-candidate@x.com' });
  const before = ts.countAdmins();
  ts.setUserAdmin(u.id, true);
  assert.equal(ts.countAdmins(), before + 1);
  assert.equal(auth.isUserAdmin(u.id), true);
  ts.setUserAdmin(u.id, false);
  assert.equal(ts.countAdmins(), before);
});

test("listUsersWithMemberships projects each user's memberships", () => {
  const t = ts.createTenant('Gamma');
  const u = auth.upsertUserOnLogin({ email: 'gamma-user@x.com' });
  ts.setMembership(u.id, t.id, 'Analyst');
  const view = ts.listUsersWithMemberships().find((x) => x.id === u.id);
  assert.ok(view);
  assert.ok(view!.memberships.some((m) => m.tenant_id === t.id && m.role === 'Analyst'));
});
