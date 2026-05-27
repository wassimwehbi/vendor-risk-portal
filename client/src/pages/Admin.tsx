import { useEffect, useState } from 'react';
import type { AdminUser, Invite, MembershipRole, Tenant } from '../types';
import { api } from '../api/client';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/AuthContext';
import { formatDate } from '../lib/format';

const MEMBERSHIP_ROLES: MembershipRole[] = ['Analyst', 'Submitter', 'Viewer'];

function UserRow({
  u,
  tenants,
  selfId,
  onAssign,
  onRevoke,
  onToggleAdmin,
  onDelete,
}: {
  u: AdminUser;
  tenants: Tenant[];
  selfId: number | undefined;
  onAssign: (userId: number, tenantId: number, role: MembershipRole) => void;
  onRevoke: (userId: number, tenantId: number) => void;
  onToggleAdmin: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
}) {
  const [tenantId, setTenantId] = useState<number | ''>('');
  const [role, setRole] = useState<MembershipRole>('Analyst');
  const assigned = new Set(u.memberships.map((m) => m.tenant_id));
  const available = tenants.filter((t) => !assigned.has(t.id));

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="break-words font-medium text-slate-800">{u.email}</div>
          {u.name && <div className="text-xs text-slate-500">{u.name}</div>}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={u.is_admin} onChange={() => onToggleAdmin(u)} />
            Global admin
          </label>
          <button
            type="button"
            className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
            disabled={u.id === selfId}
            title={u.id === selfId ? 'You cannot delete your own account' : undefined}
            onClick={() => onDelete(u)}
          >
            Delete
          </button>
        </div>
      </div>

      {u.is_admin ? (
        <p className="text-xs text-slate-500">Global admin — sees all tenants; tenant memberships are not required.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {u.memberships.length === 0 && <span className="text-xs text-slate-500">No tenant memberships.</span>}
            {u.memberships.map((m) => (
              <span
                key={m.tenant_id}
                className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1 text-xs"
              >
                <span className="font-medium text-slate-700">{m.tenant_name}</span>
                <label className="sr-only" htmlFor={`role-${u.id}-${m.tenant_id}`}>
                  Role for {m.tenant_name}
                </label>
                <select
                  id={`role-${u.id}-${m.tenant_id}`}
                  value={m.role}
                  onChange={(e) => onAssign(u.id, m.tenant_id, e.target.value as MembershipRole)}
                  className="rounded border border-slate-300 bg-white px-1 py-0.5"
                >
                  {MEMBERSHIP_ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onRevoke(u.id, m.tenant_id)}
                  className="text-slate-500 hover:text-red-600"
                  aria-label={`Remove ${m.tenant_name} membership`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          {available.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`add-tenant-${u.id}`}>
                Add {u.email} to tenant
              </label>
              <select
                id={`add-tenant-${u.id}`}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value ? Number(e.target.value) : '')}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">Add to tenant…</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`add-role-${u.id}`}>
                Role
              </label>
              <select
                id={`add-role-${u.id}`}
                value={role}
                onChange={(e) => setRole(e.target.value as MembershipRole)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                {MEMBERSHIP_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary"
                disabled={tenantId === ''}
                onClick={() => {
                  if (tenantId !== '') {
                    onAssign(u.id, tenantId, role);
                    setTenantId('');
                  }
                }}
              >
                Add
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Admin() {
  const { user, refresh } = useAuth();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState('');
  const [newTenant, setNewTenant] = useState('');
  const [busy, setBusy] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteTenant, setInviteTenant] = useState<number | ''>('');
  const [inviteRole, setInviteRole] = useState<MembershipRole>('Analyst');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  const loadTenants = () =>
    api
      .listTenants()
      .then(setTenants)
      .catch((e) => setError(e.message));
  const loadUsers = () =>
    api
      .listAdminUsers()
      .then(setUsers)
      .catch((e) => setError(e.message));
  const loadInvites = () =>
    api
      .listInvites()
      .then(setInvites)
      .catch((e) => setError(e.message));

  useEffect(() => {
    loadTenants();
    loadUsers();
    loadInvites();
  }, []);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || inviteTenant === '') return;
    setInviteBusy(true);
    setError('');
    setInviteLink('');
    setCopied(false);
    try {
      const res = await api.createInvite(inviteEmail.trim(), inviteTenant, inviteRole);
      setInviteLink(res.link);
      setInviteEmail('');
      await loadInvites();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(id: number) {
    setError('');
    try {
      await api.revokeInvite(id);
      await loadInvites();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      /* clipboard may be unavailable; the link is shown for manual copy */
    }
  }

  async function deleteTenant(t: Tenant) {
    if (!window.confirm(`Delete tenant “${t.name}”? This cannot be undone.`)) return;
    setError('');
    try {
      await api.deleteTenant(t.id);
      await Promise.all([loadTenants(), loadUsers(), loadInvites()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeUser(u: AdminUser) {
    if (!window.confirm(`Delete user ${u.email}? Their tenant access is removed; authored assessments are kept.`))
      return;
    setError('');
    try {
      await api.deleteUser(u.id);
      await Promise.all([loadUsers(), loadTenants()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!newTenant.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.createTenant(newTenant.trim());
      setNewTenant('');
      await loadTenants();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function applyUser(updated: AdminUser) {
    setUsers((us) => (us ? us.map((u) => (u.id === updated.id ? updated : u)) : us));
    loadTenants(); // member counts changed
    // If the admin edited their own access, refresh the session so the switcher updates.
    if (user && updated.id === user.id) refresh();
  }

  async function assign(userId: number, tenantId: number, role: MembershipRole) {
    setError('');
    try {
      applyUser(await api.assignMembership(userId, tenantId, role));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function revoke(userId: number, tenantId: number) {
    setError('');
    try {
      applyUser(await api.revokeMembership(userId, tenantId));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function toggleAdmin(u: AdminUser) {
    setError('');
    try {
      applyUser(await api.setUserAdmin(u.id, !u.is_admin));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Administration" subtitle="Manage tenants and assign users to tenants and roles." />
      {error && <ErrorNote message={error} />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Tenants</h2>
        <form onSubmit={createTenant} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="new-tenant">
            New tenant name
          </label>
          <input
            id="new-tenant"
            className="input sm:max-w-xs"
            placeholder="New tenant name"
            value={newTenant}
            onChange={(e) => setNewTenant(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={busy || !newTenant.trim()}>
            {busy ? 'Creating…' : 'Create tenant'}
          </button>
        </form>
        {!tenants ? (
          <div className="card px-6 py-8">
            <Spinner />
          </div>
        ) : tenants.length === 0 ? (
          <EmptyState title="No tenants yet">Create one above to start assigning users.</EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Tenants</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Slug
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Members
                  </th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{t.name}</td>
                    <td className="px-4 py-2 text-slate-500">{t.slug}</td>
                    <td className="px-4 py-2 text-slate-600">{t.member_count ?? 0}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 hover:underline"
                        onClick={() => deleteTenant(t)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Invitations</h2>
        <p className="text-sm text-slate-500">
          Generate a link that signs the recipient in and adds them to a tenant with the chosen role. Share it with them
          directly (it’s also emailed when SMTP is configured).
        </p>
        <form onSubmit={sendInvite} className="card flex flex-wrap items-end gap-2 p-4">
          <div className="w-full flex-1 sm:min-w-[14rem]">
            <label htmlFor="inv-email" className="label">
              Email
            </label>
            <input
              id="inv-email"
              type="email"
              className="input"
              placeholder="person@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="flex-1 sm:flex-none">
            <label htmlFor="inv-tenant" className="label">
              Tenant
            </label>
            <select
              id="inv-tenant"
              className="input"
              value={inviteTenant}
              onChange={(e) => setInviteTenant(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Select…</option>
              {(tenants ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 sm:flex-none">
            <label htmlFor="inv-role" className="label">
              Role
            </label>
            <select
              id="inv-role"
              className="input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as MembershipRole)}
            >
              {MEMBERSHIP_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="btn-primary w-full sm:w-auto"
            disabled={inviteBusy || !inviteEmail.trim() || inviteTenant === ''}
          >
            {inviteBusy ? 'Generating…' : 'Generate invite link'}
          </button>
        </form>

        {inviteLink && (
          <div className="card space-y-2 p-4">
            <p className="text-sm font-medium text-slate-700">
              Invite link — copy and share it now (it won’t be shown again):
            </p>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="inv-link">
                Invite link
              </label>
              <input
                id="inv-link"
                readOnly
                className="input font-mono text-xs"
                value={inviteLink}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="btn-secondary whitespace-nowrap" onClick={copyLink}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-slate-500">Expires in 7 days · single use.</p>
          </div>
        )}

        {invites && invites.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Pending invitations</caption>
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Tenant
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Expires
                  </th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{inv.email}</td>
                    <td className="px-4 py-2 text-slate-600">{inv.tenant_name}</td>
                    <td className="px-4 py-2 text-slate-600">{inv.role}</td>
                    <td className="px-4 py-2 text-slate-500">{formatDate(inv.expires_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 hover:underline"
                        onClick={() => revokeInvite(inv.id)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {invites && invites.length === 0 && <p className="text-sm text-slate-500">No pending invitations.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Users &amp; access</h2>
        {!users ? (
          <div className="card px-6 py-8">
            <Spinner />
          </div>
        ) : users.length === 0 ? (
          <EmptyState title="No users yet">Users appear here after they sign in for the first time.</EmptyState>
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                tenants={tenants ?? []}
                selfId={user?.id}
                onAssign={assign}
                onRevoke={revoke}
                onToggleAdmin={toggleAdmin}
                onDelete={removeUser}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
