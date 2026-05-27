import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { FlagAssignments } from '../types';
import { useAuth } from './AuthContext';

// A/B experiment assignments for the current user (spec 0015). Fetched once the user
// is known and re-fetched on tenant switch, since targeting is role/tenant-aware.
// The map only contains running experiments the user is eligible for; an absent key
// means "not in the experiment" → callers fall back to the control.

interface FlagsContextValue {
  flags: FlagAssignments;
  loading: boolean;
}

const FlagsContext = createContext<FlagsContextValue>({ flags: {}, loading: true });

export function FlagsProvider({ children }: { children: ReactNode }) {
  const { user, activeTenantId } = useAuth();
  const [flags, setFlags] = useState<FlagAssignments>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setFlags({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getFlags()
      .then((f) => !cancelled && setFlags(f))
      .catch(() => !cancelled && setFlags({})) // flags must never break the app
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user, activeTenantId]);

  return <FlagsContext.Provider value={{ flags, loading }}>{children}</FlagsContext.Provider>;
}

export function useFlags(): FlagsContextValue {
  return useContext(FlagsContext);
}

/**
 * The assigned variant for an experiment (or the fallback when the user is not in it).
 * Fires a one-time exposure beacon — deduped per experiment per session — only when the
 * user is actually enrolled, so exposures count real renders rather than every page load.
 */
export function useVariant(key: string, fallback = 'control'): string {
  const { flags } = useFlags();
  const variant = flags[key];
  const beaconed = useRef(false);

  useEffect(() => {
    if (beaconed.current || !variant) return;
    const sessionKey = `vrp.exposed.${key}`;
    beaconed.current = true;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');
    api.exposeExperiment(key).catch(() => undefined); // best-effort
  }, [key, variant]);

  return variant ?? fallback;
}

/** Boolean view of a flag: true only when the user is enrolled in a non-control variant. */
export function useFlag(key: string): boolean {
  const { flags } = useFlags();
  return Boolean(flags[key]) && flags[key] !== 'control';
}
