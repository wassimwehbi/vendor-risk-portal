import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthProviders, Role, SessionUser } from '../types';
import { api, setCsrfToken, setOnUnauthorized } from '../api/client';

interface AuthContextValue {
  user: SessionUser | null;
  providers: AuthProviders | null;
  loading: boolean;
  canEdit: boolean;
  canApprove: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EDIT_ROLES: Role[] = ['Analyst', 'Admin'];

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
        api.getProviders().then(setProviders).catch(() => setProviders(null)),
        refresh(),
      ]);
      setLoading(false);
    })();
    return () => setOnUnauthorized(null);
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      setUser(null);
      setCsrfToken(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      providers,
      loading,
      canEdit: !!user && EDIT_ROLES.includes(user.role),
      canApprove: !!user && EDIT_ROLES.includes(user.role),
      refresh,
      signOut,
    }),
    [user, providers, loading, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
