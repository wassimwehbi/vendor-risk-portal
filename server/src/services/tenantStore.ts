import { db, nowIso } from '../db';
import type { AdminUser, MembershipRole, Tenant, TenantMembership } from '../types';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tenant'
  );
}

export function listTenants(): Tenant[] {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id) AS member_count
       FROM tenants t ORDER BY t.name`,
    )
    .all() as Tenant[];
}

export function getTenant(id: number): Tenant | undefined {
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as Tenant | undefined;
}

export function createTenant(name: string): Tenant {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug)) {
    slug = `${base}-${n++}`;
  }
  const info = db
    .prepare('INSERT INTO tenants (name, slug, created_at) VALUES (?, ?, ?)')
    .run(name.trim(), slug, nowIso());
  return getTenant(Number(info.lastInsertRowid))!;
}

/** Find a tenant by (case-insensitive) name or create it. Used by dev-login. */
export function ensureTenant(name: string): Tenant {
  const existing = db
    .prepare('SELECT * FROM tenants WHERE name = ? COLLATE NOCASE')
    .get(name.trim()) as Tenant | undefined;
  return existing ?? createTenant(name);
}

export function setMembership(userId: number, tenantId: number, role: MembershipRole): void {
  db.prepare(
    `INSERT INTO memberships (user_id, tenant_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, tenant_id) DO UPDATE SET role = excluded.role`,
  ).run(userId, tenantId, role, nowIso());
}

export function removeMembership(userId: number, tenantId: number): boolean {
  return db.prepare('DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?').run(userId, tenantId).changes > 0;
}

export function countAdmins(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get() as { c: number };
  return row.c;
}

export function setUserAdmin(userId: number, isAdmin: boolean): void {
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
}

export function countAssessmentsForTenant(tenantId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM assessments WHERE tenant_id = ?').get(tenantId) as { c: number };
  return row.c;
}

/**
 * Deletes a tenant that has no assessments, cleaning up its memberships,
 * pending invites and (orphan) vendors. Audit rows are kept but unlinked
 * (tenant_id -> NULL) to preserve history without violating the FK.
 * Callers must verify the tenant is empty first.
 */
export function deleteEmptyTenant(tenantId: number): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE audit_log SET tenant_id = NULL WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM invites WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM memberships WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM vendors WHERE tenant_id = ?').run(tenantId);
    db.prepare('DELETE FROM tenants WHERE id = ?').run(tenantId);
  });
  tx();
}

/**
 * Deletes a user: removes their tenant memberships and pending invites. Their
 * authored assessments and audit entries are retained (created_by / actor are
 * plain email strings, not FKs). Callers enforce the self/last-admin guards.
 */
export function deleteUser(userId: number): void {
  const u = getAdminUser(userId);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memberships WHERE user_id = ?').run(userId);
    if (u) db.prepare('DELETE FROM invites WHERE email = ? AND accepted_at IS NULL').run(u.email);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
}

export function getAdminUser(userId: number): { id: number; email: string; name: string | null; is_admin: boolean } | undefined {
  const row = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?').get(userId) as
    | { id: number; email: string; name: string | null; is_admin: number }
    | undefined;
  return row ? { id: row.id, email: row.email, name: row.name ?? null, is_admin: !!row.is_admin } : undefined;
}

export function listUsersWithMemberships(): AdminUser[] {
  const users = db.prepare('SELECT id, email, name, is_admin FROM users ORDER BY email').all() as Array<{
    id: number;
    email: string;
    name: string | null;
    is_admin: number;
  }>;
  const memRows = db
    .prepare(
      `SELECT m.user_id, m.tenant_id, t.name AS tenant_name, m.role
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id ORDER BY t.name`,
    )
    .all() as Array<{ user_id: number; tenant_id: number; tenant_name: string; role: MembershipRole }>;
  const byUser = new Map<number, TenantMembership[]>();
  for (const r of memRows) {
    const arr = byUser.get(r.user_id) ?? [];
    arr.push({ tenant_id: r.tenant_id, tenant_name: r.tenant_name, role: r.role });
    byUser.set(r.user_id, arr);
  }
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    is_admin: !!u.is_admin,
    memberships: byUser.get(u.id) ?? [],
  }));
}
