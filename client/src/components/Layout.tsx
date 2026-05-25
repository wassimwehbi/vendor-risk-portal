import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { api } from '../api/client';
import type { Tenant } from '../types';

const navLinkClass =
  (variant: 'bar' | 'panel') =>
  ({ isActive }: { isActive: boolean }) =>
    `rounded-md text-sm font-medium transition-colors ${
      variant === 'panel' ? 'block px-3 py-2.5' : 'px-3 py-1.5'
    } ${isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`;

const ROLE_CLASSES: Record<string, string> = {
  Admin: 'bg-brand-100 text-brand-800',
  Analyst: 'bg-green-100 text-green-700',
  Submitter: 'bg-amber-100 text-amber-800',
  Viewer: 'bg-slate-100 text-slate-600',
};

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {open ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      ) : (
        <>
          <path d="M3 6h18" />
          <path d="M3 12h18" />
          <path d="M3 18h18" />
        </>
      )}
    </svg>
  );
}

function PrimaryNavLinks({ variant, onNavigate }: { variant: 'bar' | 'panel'; onNavigate?: () => void }) {
  const { canSubmit, canEdit, canAdmin } = useAuth();
  const cls = navLinkClass(variant);
  return (
    <>
      <NavLink to="/" end className={cls} onClick={onNavigate}>
        Dashboard
      </NavLink>
      {canEdit && (
        <NavLink to="/showcase" className={cls} onClick={onNavigate}>
          Demo Showcase
        </NavLink>
      )}
      {canSubmit && (
        <NavLink to="/assessments/new" className={cls} onClick={onNavigate}>
          New Assessment
        </NavLink>
      )}
      {canAdmin && (
        <NavLink to="/admin" className={cls} onClick={onNavigate}>
          Admin
        </NavLink>
      )}
    </>
  );
}

function TenantSwitcher({ variant = 'bar' }: { variant?: 'bar' | 'panel' }) {
  const { user, isAdmin, tenants, activeTenantId, switchTenant } = useAuth();
  const [adminTenants, setAdminTenants] = useState<Tenant[]>([]);
  const [switching, setSwitching] = useState(false);
  const isPanel = variant === 'panel';

  useEffect(() => {
    if (isAdmin) api.listTenants().then(setAdminTenants).catch(() => undefined);
  }, [isAdmin]);

  if (!user) return null;
  // Non-admin with no tenant: the no-access shell covers this case.
  if (!isAdmin && tenants.length === 0) return null;

  // A single, fixed tenant — no need for a dropdown.
  if (!isAdmin && tenants.length === 1) {
    return (
      <span
        className={`items-center rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 ${
          isPanel ? 'inline-flex' : 'hidden sm:inline-flex'
        }`}
      >
        {tenants[0].tenant_name}
      </span>
    );
  }

  const options = isAdmin
    ? [{ value: 'all', label: 'All tenants' }, ...adminTenants.map((t) => ({ value: String(t.id), label: t.name }))]
    : tenants.map((m) => ({ value: String(m.tenant_id), label: m.tenant_name }));
  const current = activeTenantId == null ? 'all' : String(activeTenantId);

  async function onChange(value: string) {
    setSwitching(true);
    try {
      await switchTenant(value === 'all' ? 'all' : Number(value));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <label className={`flex items-center gap-1.5 ${isPanel ? 'w-full' : ''}`}>
      <span className="sr-only">Active tenant</span>
      <select
        value={current}
        disabled={switching}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60 ${
          isPanel ? 'w-full py-2 text-sm' : ''
        }`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function UserMenu({ variant = 'bar' }: { variant?: 'bar' | 'panel' }) {
  const { user, signOut, activeRole } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  const roleLabel = activeRole ?? 'No access';
  const roleBadge = (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_CLASSES[roleLabel] ?? 'bg-slate-100 text-slate-600'}`}>
      {roleLabel}
    </span>
  );

  if (variant === 'panel') {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">{user.name || user.email}</div>
          <div className="break-all text-xs text-slate-500">{user.email}</div>
        </div>
        <div className="flex items-center justify-between gap-3">
          {roleBadge}
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right lg:block">
        <div className="text-sm font-medium text-slate-800">{user.name || user.email}</div>
        <div className="text-xs text-slate-500">{user.email}</div>
      </div>
      {roleBadge}
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

function NoTenantAccess() {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-base font-medium text-slate-700">No tenant access yet</p>
      <p className="max-w-md text-sm text-slate-500">
        Your account isn’t associated with any tenant. An administrator needs to assign you to one before you
        can submit or view assessments.
      </p>
    </div>
  );
}

export function Layout() {
  const { hasNoTenants } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu on route change and when the viewport grows to the
  // desktop breakpoint (where the full bar is shown instead of the panel).
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => mq.matches && setMobileOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow focus:outline-none focus:ring-2 focus:ring-brand-600/40"
      >
        Skip to main content
      </a>
      <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="flex min-w-0 items-center gap-6">
              <NavLink to="/" className="flex items-center gap-2.5">
                <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded bg-slate-800 text-[11px] font-bold tracking-tight text-white">VR</span>
                <span className="truncate text-sm font-semibold tracking-tight text-slate-800">Vendor Risk Portal</span>
              </NavLink>
              <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
                <PrimaryNavLinks variant="bar" />
              </nav>
            </div>
            <div className="hidden items-center gap-3 lg:flex">
              <TenantSwitcher />
              <UserMenu />
            </div>
            <button
              type="button"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              onClick={() => setMobileOpen((v) => !v)}
              className="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-600/30 lg:hidden"
            >
              <MenuIcon open={mobileOpen} />
            </button>
          </div>

          {mobileOpen && (
            <div id="mobile-menu" className="border-t border-slate-200 py-3 lg:hidden">
              <nav aria-label="Primary" className="flex flex-col gap-1">
                <PrimaryNavLinks variant="panel" onNavigate={() => setMobileOpen(false)} />
              </nav>
              <div className="mt-3 flex flex-col gap-3 border-t border-slate-200 pt-3">
                <TenantSwitcher variant="panel" />
                <UserMenu variant="panel" />
              </div>
            </div>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 focus:outline-none">
        {hasNoTenants ? <NoTenantAccess /> : <Outlet />}
      </main>
      <footer className="no-print mx-auto max-w-7xl px-4 py-6 text-center text-xs text-slate-400">
        AI-assisted preliminary analysis · ISO 27001 · ISO 27002 · GDPR · NIST · Human analyst retains final decision authority
      </footer>
    </div>
  );
}
