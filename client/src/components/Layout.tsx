import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
  }`;

const ROLE_CLASSES: Record<string, string> = {
  Admin: 'bg-brand-100 text-brand-800',
  Analyst: 'bg-green-100 text-green-700',
  Viewer: 'bg-slate-100 text-slate-600',
};

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <div className="text-sm font-medium text-slate-800">{user.name || user.email}</div>
        <div className="text-xs text-slate-500">{user.email}</div>
      </div>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_CLASSES[user.role] ?? 'bg-slate-100 text-slate-600'}`}>
        {user.role}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow focus:outline-none focus:ring-2 focus:ring-brand-600/40"
      >
        Skip to main content
      </a>
      <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2.5">
              <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded bg-slate-800 text-[11px] font-bold tracking-tight text-white">VR</span>
              <span className="text-sm font-semibold tracking-tight text-slate-800">Vendor Risk Portal</span>
            </NavLink>
            <nav aria-label="Primary" className="flex items-center gap-1">
              <NavLink to="/" end className={navLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/showcase" className={navLinkClass}>
                Demo Showcase
              </NavLink>
              <NavLink to="/assessments/new" className={navLinkClass}>
                New Assessment
              </NavLink>
            </nav>
          </div>
          <UserMenu />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 focus:outline-none">
        <Outlet />
      </main>
      <footer className="no-print mx-auto max-w-7xl px-4 py-6 text-center text-xs text-slate-400">
        AI-assisted preliminary analysis · ISO 27001 · ISO 27002 · GDPR · NIST · Human analyst retains final decision authority
      </footer>
    </div>
  );
}
