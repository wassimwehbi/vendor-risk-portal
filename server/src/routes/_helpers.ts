import type { Request, Response } from 'express';
import type { Role } from '../types';

/**
 * Per-request access scope, built by the `resolveTenant` middleware from the
 * authenticated session + live membership reads. This is the single source of
 * truth for tenant isolation and role gating; it is NEVER derived from
 * client-supplied input.
 *
 *  - isAdmin            global cross-tenant superuser
 *  - activeTenantId     the tenant this request is scoped to (null only for an
 *                       admin in "all tenants" mode)
 *  - effectiveRole      'Admin' for admins; otherwise the membership role for
 *                       the active tenant
 *  - ownOnly            true for Submitters — restricts reads to their own
 *                       (created_by) assessments
 */
export interface AccessScope {
  actor: string; // user email
  userId: number;
  isAdmin: boolean;
  activeTenantId: number | null;
  effectiveRole: Role;
  ownOnly: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      scope?: AccessScope;
    }
  }
}

/** Returns the access scope attached by `resolveTenant`. */
export function getScope(req: Request): AccessScope {
  if (!req.scope) {
    // resolveTenant runs before every feature route; this is a defensive guard.
    throw new Error('Access scope not resolved');
  }
  return req.scope;
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

export function parseId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
