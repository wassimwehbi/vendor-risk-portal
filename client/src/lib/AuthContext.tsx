import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthProviders, Role, SessionUser, TenantMembership } from '../types';
import { api, setCsrfToken, setOnUnauthorized } from '../api/client';

interface AuthContextValue {
  user: SessionUser | null;
  providers: AuthProviders | null;
  loading: boolean;
  // Effective role + permissions are derived from the ACTIVE tenant's membership
  // (or the global admin flag). These are UX hints only — the server enforces
  // every rule independently (see lib/role.ts).
  activeRole: Role | null;
  isAdmin: boolean;
  canAdmin: boolean; // manage tenants/users
  canSubmit: boolean; // create + upload assessments
  canEdit: boolean; // analyze / override / notes
  canApprove: boolean; // validate
  isSubmitterScope: boolean; // own-submissions-only
  hasNoTenants: boolean; // provisioned, non-admin, but no tenant access yet
  tenants: TenantMembership[];
  activeTenantId: number | null;
  switchTenant: (target: number | 'all') => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const session = await api.getSession();
      setUser(session.user);
      setCsrfToken(session.csrfToken);
    } catch {
      setUser(null);
      setCsrfToken(null);
    }
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      setUser(null);
      setCsrfToken(null);
    });
    (async () => {
      await Promise.all([
        api
          .getProviders()
          .then(setProviders)
          .catch(() => setProviders(null)),
        refresh(),
      ]);
      setLoading(false);
    })();
    return () => setOnUnauthorized(null);
  }, [refresh]);

  const switchTenant = useCallback(async (target: number | 'all') => {
    const session = await api.switchTenant(target === 'all' ? null : target);
    setUser(session.user);
    setCsrfToken(session.csrfToken);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      setUser(null);
      setCsrfToken(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const memberships = user?.memberships ?? [];
    const activeRole: Role | null = user
      ? user.isAdmin
        ? 'Admin'
        : (memberships.find((m) => m.tenant_id === user.activeTenantId)?.role ?? null)
      : null;
    const isAdmin = !!user?.isAdmin;
    const canEdit = activeRole === 'Admin' || activeRole === 'Analyst';
    return {
      user,
      providers,
      loading,
      activeRole,
      isAdmin,
      canAdmin: isAdmin,
      canSubmit: canEdit || activeRole === 'Submitter',
      canEdit,
      canApprove: canEdit,
      isSubmitterScope: activeRole === 'Submitter',
      hasNoTenants: !!user && !isAdmin && memberships.length === 0,
      tenants: memberships,
      activeTenantId: user?.activeTenantId ?? null,
      switchTenant,
      refresh,
      signOut,
    };
  }, [user, providers, loading, switchTenant, refresh, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
