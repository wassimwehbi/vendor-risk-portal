import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, authUrl } from '../api/client';
import { useAuth } from '../lib/AuthContext';
import { ErrorNote } from '../components/ui';

// The developer sign-in is only ever offered when the app is actually running on
// a local machine — in addition to the server only enabling it in dev mode.
const IS_LOCAL =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/.test(window.location.hostname);

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect width="8" height="8" x="1" y="1" fill="#F25022" />
      <rect width="8" height="8" x="9" y="1" fill="#7FBA00" />
      <rect width="8" height="8" x="1" y="9" fill="#00A4EF" />
      <rect width="8" height="8" x="9" y="9" fill="#FFB900" />
    </svg>
  );
}

export function Login() {
  const { providers, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devRole, setDevRole] = useState('Analyst');
  const [showDev, setShowDev] = useState(false);
  const [status, setStatus] = useState('');
  const [devLink, setDevLink] = useState('');
  const [error, setError] = useState(params.get('error') ? decodeURIComponent(params.get('error')!) : '');
  const [busy, setBusy] = useState(false);

  const showDevOption = IS_LOCAL && providers?.dev;
  const hasSso = providers?.google || providers?.microsoft;
  const hasAnyMethod = hasSso || providers?.email || showDevOption;

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your work email.');
    setBusy(true);
    setError('');
    setStatus('');
    setDevLink('');
    try {
      const res = await api.requestMagicLink(email.trim());
      setStatus(`If ${email.trim()} is authorized, a secure sign-in link is on its way. Check your inbox.`);
      if (res.devLink) setDevLink(res.devLink);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!devEmail.trim()) return setError('Enter an email for the local session.');
    setBusy(true);
    setError('');
    try {
      await api.devLogin(devEmail.trim(), devRole);
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
            <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-lg bg-slate-800 text-sm font-bold tracking-tight text-white">VR</span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">Vendor Risk Portal</h1>
              <p className="text-sm text-slate-500">AI-assisted vendor security &amp; privacy reviews</p>
            </div>
          </div>

          <div className="card p-7">
            <h2 className="text-base font-semibold text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Use your organization account to continue.</p>

            <div className="mt-5 space-y-4">
              {error && <ErrorNote message={error} />}
              {status && (
                <div role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
                  <p>{status}</p>
                  {devLink && (
                    <a href={devLink} className="mt-1 block break-all font-medium underline">
                      Local dev: open sign-in link
                    </a>
                  )}
                </div>
              )}

              {/* SSO providers */}
              {hasSso && (
                <div className="space-y-2.5">
                  {providers?.microsoft && (
                    <a href={authUrl('microsoft')} className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
                      <MicrosoftIcon /> Continue with Microsoft
                    </a>
                  )}
                  {providers?.google && (
                    <a href={authUrl('google')} className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
                      <GoogleIcon /> Continue with Google
                    </a>
                  )}
                </div>
              )}

              {/* Email magic link */}
              {providers?.email && (
                <>
                  {hasSso && (
                    <div className="flex items-center gap-3">
                      <span className="h-px flex-1 bg-slate-200" />
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">or</span>
                      <span className="h-px flex-1 bg-slate-200" />
                    </div>
                  )}
                  <form onSubmit={magicLink} className="space-y-2">
                    <label className="label" htmlFor="login-email">Work email</label>
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      className="input"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <button type="submit" className="btn-primary w-full" disabled={busy}>
                      {busy ? 'Sending…' : 'Email me a sign-in link'}
                    </button>
                  </form>
                </>
              )}

              {!hasAnyMethod && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No sign-in methods are configured. Contact your administrator.
                </p>
              )}
            </div>
          </div>

          {/* Local developer sign-in (local machine only) */}
          {showDevOption && (
            <div className="mt-4 text-center">
              {!showDev ? (
                <button
                  type="button"
                  onClick={() => setShowDev(true)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Developer sign-in (local only)
                </button>
              ) : (
                <div className="card p-4 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Developer sign-in · local only</span>
                    <button type="button" className="text-xs text-slate-500 hover:text-slate-700" onClick={() => setShowDev(false)}>
                      Hide
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Bypasses SSO for local development. Not available in production.</p>
                  <form onSubmit={devLogin} className="mt-3 flex gap-2">
                    <input
                      type="email"
                      aria-label="Email for local developer session"
                      className="input"
                      placeholder="you@company.com"
                      value={devEmail}
                      onChange={(e) => setDevEmail(e.target.value)}
                    />
                    <select
                      aria-label="Role for local developer session"
                      className="input w-28"
                      value={devRole}
                      onChange={(e) => setDevRole(e.target.value)}
                    >
                      <option>Analyst</option>
                      <option>Admin</option>
                      <option>Viewer</option>
                    </select>
                    <button type="submit" className="btn-secondary whitespace-nowrap" disabled={busy}>
                      Sign in
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          <p className="mt-6 text-center text-xs leading-relaxed text-slate-400">
            This is a restricted system for authorized users only. All activity is monitored and
            recorded in the audit trail. Unauthorized access is prohibited.
          </p>
        </div>
      </main>
    </div>
  );
}
