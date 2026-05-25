import { db, nowIso } from '../db';
import { authConfig } from './auth';

/**
 * One-time, idempotent data backfill for the multi-tenancy migration. Runs at
 * startup after the schema/column migrations in db.ts.
 *
 *  - Creates a "Default" tenant.
 *  - Assigns any orphan (pre-tenant) vendors/assessments/audit rows to it.
 *  - Backfills assessments.created_by from validated_by (or 'system').
 *  - ONLY on the very first migration (when the Default tenant did not yet
 *    exist) seeds memberships for the users that already existed: admin-listed
 *    emails become global admins, everyone else gets a Default-tenant membership
 *    with their legacy role. Users created afterwards (e.g. new OAuth sign-ins)
 *    are intentionally left unprovisioned until an admin assigns them.
 */
export function bootstrapMultiTenancy(): void {
  const now = nowIso();
  const existing = db.prepare("SELECT id FROM tenants WHERE slug = 'default'").get() as
    | { id: number }
    | undefined;
  const firstMigration = !existing;

  const tenantId = existing
    ? existing.id
    : Number(
        db
          .prepare("INSERT INTO tenants (name, slug, created_at) VALUES ('Default', 'default', ?)")
          .run(now).lastInsertRowid,
      );

  const adminEmails = new Set(authConfig.adminEmails);

  const tx = db.transaction(() => {
    // Always-safe: attach any rows still missing a tenant to Default.
    db.prepare('UPDATE vendors SET tenant_id = ? WHERE tenant_id IS NULL').run(tenantId);
    db.prepare('UPDATE assessments SET tenant_id = ? WHERE tenant_id IS NULL').run(tenantId);
    db.prepare('UPDATE audit_log SET tenant_id = ? WHERE tenant_id IS NULL').run(tenantId);
    db.prepare("UPDATE assessments SET created_by = COALESCE(validated_by, 'system') WHERE created_by IS NULL").run();

    if (firstMigration) {
      const users = db.prepare('SELECT id, email, role FROM users').all() as Array<{
        id: number;
        email: string;
        role: string;
      }>;
      const insertMembership = db.prepare(
        'INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?)',
      );
      const setAdmin = db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?');
      for (const u of users) {
        if (adminEmails.has(u.email.toLowerCase())) {
          setAdmin.run(u.id);
        } else {
          const role = ['Analyst', 'Viewer', 'Submitter'].includes(u.role) ? u.role : 'Analyst';
          insertMembership.run(u.id, tenantId, role, now);
        }
      }
    }
  });
  tx();
}
