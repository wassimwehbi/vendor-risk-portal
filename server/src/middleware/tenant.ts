import type { NextFunction, Request, Response } from 'express';
import { db } from '../db';
import type { Role } from '../types';

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

/**
 * Builds `req.scope` from the authenticated session. Memberships are read LIVE
 * from the DB on every request (not trusted from the session snapshot) so that
 * an admin's membership/role change takes effect immediately. Mount AFTER
 * `requireAuth`/`requireCsrf` and BEFORE the feature/admin routers.
 */
export function resolveTenant(req: Request, res: Response, next: NextFunction): void {
  const user = req.session?.user;
  if (!user) {
    fail(res, 401, 'Authentication required');
    return;
  }

  // Live-read the user so deletion/demotion takes effect immediately (the
  // session snapshot may be stale).
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(user.id) as { is_admin: number } | undefined;
  if (!row) {
    fail(res, 403, 'Your account no longer exists. Please sign in again.');
    return;
  }
  const isAdmin = !!row.is_admin;
  const activeTenantId = user.activeTenantId ?? null;

  if (isAdmin) {
    req.scope = {
      actor: user.email,
      userId: user.id,
      isAdmin: true,
      activeTenantId, // null = all-tenants read mode
      effectiveRole: 'Admin',
      ownOnly: false,
    };
    next();
    return;
  }

  // Non-admin: must have a membership in the active tenant.
  if (activeTenantId == null) {
    fail(res, 403, 'No tenant access — contact an administrator.');
    return;
  }
  const membership = db
    .prepare('SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?')
    .get(user.id, activeTenantId) as { role: Role } | undefined;
  if (!membership) {
    fail(res, 403, 'No tenant access — contact an administrator.');
    return;
  }

  req.scope = {
    actor: user.email,
    userId: user.id,
    isAdmin: false,
    activeTenantId,
    effectiveRole: membership.role,
    ownOnly: membership.role === 'Submitter',
  };
  next();
}

/** Restricts a route to global admins. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.scope?.isAdmin) return next();
  fail(res, 403, 'Admin access required');
}

/**
 * Restricts a route to the given tenant roles. Admins always pass. Replaces the
 * old inline `if (role === 'Viewer')` checks with an allow-list per route.
 */
export function requireTenantRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scope = req.scope;
    if (!scope) return fail(res, 403, 'Forbidden');
    if (scope.isAdmin) return next();
    if (allowed.includes(scope.effectiveRole)) return next();
    fail(res, 403, `This action requires role: ${allowed.join(' or ')}`);
  };
}
