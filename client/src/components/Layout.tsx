import { NavLink, Outlet } from 'react-router-dom';
import type { Role } from '../types';
import { useRole } from '../lib/RoleContext';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
  }`;

function RoleSelector() {
  const { identity, setName, setRole } = useRole();
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label="Analyst name"
        className="w-36 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25"
        value={identity.name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        aria-label="Role"
        className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25"
        value={identity.role}
        onChange={(e) => setRole(e.target.value as Role)}
      >
        <option value="Analyst">Analyst</option>
        <option value="Admin">Admin</option>
        <option value="Viewer">Viewer</option>
      </select>
    </div>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded bg-slate-800 text-[11px] font-bold tracking-tight text-white">VR</span>
              <span className="text-sm font-semibold tracking-tight text-slate-800">Vendor Risk Portal</span>
            </NavLink>
            <nav className="flex items-center gap-1">
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
          <RoleSelector />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="no-print mx-auto max-w-7xl px-4 py-6 text-center text-xs text-slate-400">
        AI-assisted preliminary analysis · ISO 27001 · ISO 27002 · GDPR · NIST · Human analyst retains final decision authority
      </footer>
    </div>
  );
}
