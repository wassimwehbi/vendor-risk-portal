import type { AccessScope } from '../src/routes/_helpers';
import type { Role } from '../src/types';

/** Builds an AccessScope for tests (mirrors what resolveTenant produces). */
export function scopeFor(opts: {
  actor?: string;
  userId?: number;
  tenantId: number | null;
  role: Role;
  isAdmin?: boolean;
}): AccessScope {
  const isAdmin = opts.isAdmin ?? opts.role === 'Admin';
  return {
    actor: opts.actor ?? 'tester@acme.com',
    userId: opts.userId ?? 1,
    isAdmin,
    activeTenantId: opts.tenantId,
    effectiveRole: opts.role,
    ownOnly: !isAdmin && opts.role === 'Submitter',
  };
}
