import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, setCsrfToken } from '../api/client';
import { useAuth } from '../lib/AuthContext';
import { ErrorNote, Spinner } from '../components/ui';
import type { MembershipRole } from '../types';

interface InviteInfo {
  email: string;
  tenant_name: string;
  role: MembershipRole;
}

/**
 * Public invitation confirmation page. The invite token in the URL is only a
 * preview credential here: we fetch a non-mutating preview, and the single-use
 * invite is consumed ONLY when the human clicks "Accept invitation" (an explicit
 * POST). Unfurlers / prefetchers hitting this page never burn the invite.
 */
export function InviteAccept() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) {
          setInvalid(true);
          setLoading(false);
        }
        return;
      }
      try {
        const res = await api.getInviteInfo(token);
        if (!cancelled) setInfo(res);
      } catch {
        if (!cancelled) setInvalid(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const res = await api.acceptInvite(token);
      setCsrfToken(res.csrfToken);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 place-items-center rounded-lg bg-slate-800 text-sm font-bold tracking-tight text-white"
            >
              VR
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">Vendor Risk Portal</h1>
              <p className="text-sm text-slate-500">AI-assisted vendor security &amp; privacy reviews</p>
            </div>
          </div>

          <div className="card p-5 sm:p-7">
            {loading ? (
              <div className="flex justify-center py-4">
                <Spinner label="Checking your invitation…" />
              </div>
            ) : invalid ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-slate-900">Invitation unavailable</h2>
                <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  This invitation link is invalid, has expired, or has already been used.
                </div>
                <Link to="/login" className="btn-secondary w-full">
                  Go to sign in
                </Link>
              </div>
            ) : info ? (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-slate-900">You&rsquo;re invited</h2>
                <div role="status" className="rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand-800">
                  <p className="break-words">
                    You&rsquo;ve been invited to <span className="font-semibold">{info.tenant_name}</span> as{' '}
                    <span className="font-semibold">{info.role}</span>.
                  </p>
                  <p className="mt-1 break-words text-brand-700">
                    Signing in as <span className="font-medium">{info.email}</span>.
                  </p>
                </div>
                {error && <ErrorNote message={error} />}
                <button type="button" className="btn-primary w-full" onClick={accept} disabled={busy}>
                  {busy ? 'Accepting…' : 'Accept invitation'}
                </button>
                <p className="text-center text-xs text-slate-500">
                  Not you?{' '}
                  <Link to="/login" className="font-medium text-slate-500 underline hover:text-slate-700">
                    Go to sign in
                  </Link>
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
