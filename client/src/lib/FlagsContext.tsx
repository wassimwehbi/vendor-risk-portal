import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { FlagAssignments } from '../types';
import { useAuth } from './AuthContext';

// A/B experiment assignments for the current user (spec 0015). Fetched once the user is known and
// re-fetched on tenant switch, since targeting is role/tenant-aware. The map only contains running
// experiments the user is eligible for; an absent key means "not in the experiment".

interface FlagsContextValue {
  flags: FlagAssignments;
  loading: boolean;
  subject: number | null; // current user id — scopes exposure dedup so a new user on a shared tab re-beacons
}

const FlagsContext = createContext<FlagsContextValue>({ flags: {}, loading: true, subject: null });

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

  return (
    <FlagsContext.Provider value={{ flags, loading, subject: user?.id ?? null }}>{children}</FlagsContext.Provider>
  );
}

export function useFlags(): FlagsContextValue {
  return useContext(FlagsContext);
}

/**
 * The assigned variant for an experiment (or the fallback when the user is not in it). Fires a
 * one-time exposure beacon — deduped per (user, experiment, variant) — only when the user is
 * actually enrolled. Keying the dedup on user + variant means a different user on a shared tab (or a
 * re-assignment) beacons correctly; the in-memory guard keys on the same tag, so it resets when they
 * change and still works if sessionStorage is unavailable.
 */
export function useVariant(key: string, fallback = 'control'): string {
  const { flags, subject } = useFlags();
  const variant = flags[key];
  const lastBeaconed = useRef<string | null>(null);

  useEffect(() => {
    if (!variant) return;
    const tag = `${subject ?? 'anon'}:${key}:${variant}`;
    if (lastBeaconed.current === tag) return; // in-memory dedup (also the fallback if storage throws)
    lastBeaconed.current = tag;
    const sessionKey = `vrp.exposed.${tag}`;
    try {
      if (sessionStorage.getItem(sessionKey)) return; // already beaconed earlier this session
      sessionStorage.setItem(sessionKey, '1');
    } catch {
      // sessionStorage can throw (disabled / quota / private mode) — rely on the in-memory guard.
    }
    api.exposeExperiment(key).catch(() => undefined); // best-effort
  }, [key, variant, subject]);

  return variant ?? fallback;
}

/**
 * Boolean view of a flag: true when the user is assigned `variant` (default 'treatment'). Compares
 * the assigned variant directly — it makes no assumption about the control variant's name. Does NOT
 * record exposure; pair with useVariant for the branch you actually render.
 */
export function useFlag(key: string, variant = 'treatment'): boolean {
  const { flags } = useFlags();
  return flags[key] === variant;
}
