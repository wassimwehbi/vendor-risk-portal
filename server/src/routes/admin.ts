import { Router } from 'express';
import { z } from 'zod';
import type { AdminUser } from '../types';
import { fail, getScope, ok, parseId } from './_helpers';
import {
  createTenant,
  getAdminUser,
  getTenant,
  listTenants,
  listUsersWithMemberships,
  removeMembership,
  setMembership,
  setUserAdmin,
  countAdmins,
  countAssessmentsForTenant,
  deleteEmptyTenant,
  deleteUser,
} from '../services/tenantStore';
import { authConfig, getMembershipsForUser, isAllowedDomain, isValidEmail, normalizeEmail } from '../services/auth';
import { createInvite, listPendingInvites, revokeInvite } from '../services/invites';
import { sendInvite } from '../services/mailer';
import { logAudit } from '../services/audit';

// Mounted at /api/admin behind requireAdmin (see index.ts).
const router = Router();

function adminUserView(userId: number): AdminUser | undefined {
  const u = getAdminUser(userId);
  if (!u) return undefined;
  return { ...u, memberships: getMembershipsForUser(userId) };
}

// ---- Tenants ---------------------------------------------------------------

router.get('/tenants', (_req, res) => {
  ok(res, listTenants());
});

const tenantSchema = z.object({ name: z.string().min(1, 'name is required') });

router.post('/tenants', (req, res) => {
  const parsed = tenantSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const tenant = createTenant(parsed.data.name);
  logAudit({ assessment_id: 0, tenant_id: tenant.id, action: 'tenant_created', actor: getScope(req).actor, role: 'Admin', details: { name: tenant.name } });
  ok(res, tenant, 201);
});

router.delete('/tenants/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid tenant id');
  const tenant = getTenant(id);
  if (!tenant) return fail(res, 404, 'Tenant not found');
  const n = countAssessmentsForTenant(id);
  if (n > 0) return fail(res, 400, `Tenant has ${n} assessment${n === 1 ? '' : 's'}; remove them first.`);
  deleteEmptyTenant(id);
  logAudit({ assessment_id: 0, tenant_id: null, action: 'tenant_deleted', actor: getScope(req).actor, role: 'Admin', details: { tenant_id: id, name: tenant.name } });
  ok(res, { deleted: true });
});

// ---- Invitations -----------------------------------------------------------

router.get('/invites', (_req, res) => {
  ok(res, listPendingInvites());
});

const inviteSchema = z.object({
  email: z.string().min(3),
  tenantId: z.number().int().positive(),
  role: z.enum(['Analyst', 'Submitter', 'Viewer']),
});

router.post('/invites', async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const email = normalizeEmail(parsed.data.email);
  if (!isValidEmail(email)) return fail(res, 400, 'A valid email address is required.');
  if (!isAllowedDomain(email)) return fail(res, 403, 'That email domain is not permitted to sign in.');
  if (!getTenant(parsed.data.tenantId)) return fail(res, 404, 'Tenant not found');

  const actor = getScope(req).actor;
  const { invite, token } = createInvite({ email, tenantId: parsed.data.tenantId, role: parsed.data.role, invitedBy: actor });
  const link = `${authConfig.clientOrigin}/invite?token=${encodeURIComponent(token)}`;

  let emailed = false;
  try {
    await sendInvite(email, link, invite.tenant_name);
    emailed = authConfig.smtpConfigured;
  } catch (e) {
    console.error('[admin] invite email failed:', (e as Error).message);
  }

  logAudit({ assessment_id: 0, tenant_id: invite.tenant_id, action: 'invite_created', actor, role: 'Admin', details: { email, role: invite.role } });
  // The raw link is returned once (only its hash is stored). devLink mirrors it
  // for local dev where no SMTP is configured.
  ok(res, { invite, link, emailed, devLink: authConfig.devMode ? link : undefined }, 201);
});

router.delete('/invites/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid invite id');
  if (!revokeInvite(id)) return fail(res, 404, 'Invite not found');
  logAudit({ assessment_id: 0, tenant_id: null, action: 'invite_revoked', actor: getScope(req).actor, role: 'Admin', details: { invite_id: id } });
  ok(res, { revoked: true });
});

// ---- Users + memberships ---------------------------------------------------

router.get('/users', (_req, res) => {
  ok(res, listUsersWithMemberships());
});

const membershipSchema = z.object({
  tenantId: z.number().int().positive(),
  role: z.enum(['Analyst', 'Submitter', 'Viewer']), // 'Admin' is a global flag, never a membership
});

router.post('/users/:id/memberships', (req, res) => {
  const userId = parseId(req.params.id);
  if (userId === null) return fail(res, 400, 'Invalid user id');
  if (!getAdminUser(userId)) return fail(res, 404, 'User not found');
  const parsed = membershipSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');

  setMembership(userId, parsed.data.tenantId, parsed.data.role);
  logAudit({
    assessment_id: 0,
    tenant_id: parsed.data.tenantId,
    action: 'membership_set',
    actor: getScope(req).actor,
    role: 'Admin',
    details: { user_id: userId, role: parsed.data.role },
  });
  ok(res, adminUserView(userId));
});

router.delete('/users/:id/memberships/:tenantId', (req, res) => {
  const userId = parseId(req.params.id);
  const tenantId = parseId(req.params.tenantId);
  if (userId === null || tenantId === null) return fail(res, 400, 'Invalid id');
  const removed = removeMembership(userId, tenantId);
  if (!removed) return fail(res, 404, 'Membership not found');
  logAudit({ assessment_id: 0, tenant_id: tenantId, action: 'membership_removed', actor: getScope(req).actor, role: 'Admin', details: { user_id: userId } });
  ok(res, adminUserView(userId));
});

const adminFlagSchema = z.object({ is_admin: z.boolean() });

router.patch('/users/:id', (req, res) => {
  const userId = parseId(req.params.id);
  if (userId === null) return fail(res, 400, 'Invalid user id');
  const target = getAdminUser(userId);
  if (!target) return fail(res, 404, 'User not found');
  const parsed = adminFlagSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');

  // Never allow removing the last global admin (lockout protection).
  if (target.is_admin && !parsed.data.is_admin && countAdmins() <= 1) {
    return fail(res, 400, 'Cannot remove the last administrator.');
  }

  setUserAdmin(userId, parsed.data.is_admin);
  logAudit({ assessment_id: 0, tenant_id: null, action: 'admin_flag_set', actor: getScope(req).actor, role: 'Admin', details: { user_id: userId, is_admin: parsed.data.is_admin } });
  ok(res, adminUserView(userId));
});

router.delete('/users/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid user id');
  const target = getAdminUser(id);
  if (!target) return fail(res, 404, 'User not found');
  const scope = getScope(req);
  if (id === scope.userId) return fail(res, 400, 'You cannot delete your own account.');
  if (target.is_admin && countAdmins() <= 1) return fail(res, 400, 'Cannot delete the last administrator.');
  deleteUser(id);
  logAudit({ assessment_id: 0, tenant_id: null, action: 'user_deleted', actor: scope.actor, role: 'Admin', details: { user_id: id, email: target.email } });
  ok(res, { deleted: true });
});

export default router;
