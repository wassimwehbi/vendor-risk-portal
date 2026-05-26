import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  authConfig,
  providersEnabled,
  upsertUserOnLogin,
  buildSessionUser,
  createMagicToken,
  verifyMagicToken,
  isAllowedDomain,
  isValidEmail,
  normalizeEmail,
  AuthPolicyError,
} from '../services/auth';
import { ensureTenant, setMembership, setUserAdmin } from '../services/tenantStore';
import { findValidInvite, getInviteInfo, markInviteAccepted } from '../services/invites';
import { db } from '../db';
import { sendMagicLink } from '../services/mailer';
import { ensureCsrf, loginUser, logoutUser, requireAuth, requireCsrf } from '../middleware/auth';
import type { SessionUser } from '../types';
import { fail, ok } from './_helpers';

// Mounted at /api/auth — route paths here are relative to that.
const router = Router();

// Strict throttle for credential-submitting endpoints (login / email send),
// independent of the generous API-wide limiter.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

// ---- Session + provider discovery -----------------------------------------

router.get('/session', (req, res) => {
  let user = req.session.user ?? null;
  if (user) {
    // Re-resolve admin flag + memberships live so the client reflects any
    // admin-side changes without requiring a fresh login.
    user = buildSessionUser(user);
    req.session.user = user;
  }
  ok(res, { user, csrfToken: user ? ensureCsrf(req) : null });
});

// Switch the session's active tenant (membership-verified; admins may pick any
// tenant or null = all-tenants). Does NOT regenerate the session.
const activeTenantSchema = z.object({ tenant_id: z.number().int().positive().nullable() });

router.post('/active-tenant', requireAuth, requireCsrf, (req, res) => {
  const user = req.session.user!;
  const parsed = activeTenantSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'tenant_id must be a positive integer or null');
  const target = parsed.data.tenant_id;

  if (!user.isAdmin) {
    if (target === null) return fail(res, 400, 'A tenant must be selected');
    const member = db.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND tenant_id = ?').get(user.id, target);
    if (!member) return fail(res, 403, 'You are not a member of that tenant');
  } else if (target !== null) {
    if (!db.prepare('SELECT 1 FROM tenants WHERE id = ?').get(target)) return fail(res, 404, 'Tenant not found');
  }

  const refreshed = buildSessionUser(user, target);
  req.session.user = refreshed;
  req.session.save((err) => {
    if (err) return fail(res, 500, 'Failed to update active tenant');
    ok(res, { user: refreshed, csrfToken: ensureCsrf(req) });
  });
});

router.get('/providers', (_req, res) => {
  ok(res, providersEnabled());
});

// ---- Google -----------------------------------------------------------------

router.get('/google', (req, res, next) => {
  if (!providersEnabled().google) return fail(res, 404, 'Google sign-in is not configured');
  passport.authenticate('google', { session: false, scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', (req, res, next) => oauthCallback('google', req, res, next));

// ---- Microsoft --------------------------------------------------------------

router.get('/microsoft', (req, res, next) => {
  if (!providersEnabled().microsoft) return fail(res, 404, 'Microsoft sign-in is not configured');
  passport.authenticate('microsoft', { session: false, scope: ['user.read'] })(req, res, next);
});

router.get('/microsoft/callback', (req, res, next) => oauthCallback('microsoft', req, res, next));

function oauthCallback(strategy: 'google' | 'microsoft', req: Request, res: Response, next: NextFunction): void {
  passport.authenticate(
    strategy,
    { session: false },
    async (err: unknown, user: SessionUser | false, info: { message?: string } | undefined) => {
      if (err || !user) {
        const reason = encodeURIComponent(info?.message || 'Sign-in failed');
        return res.redirect(`${authConfig.clientOrigin}/login?error=${reason}`);
      }
      try {
        await loginUser(req, buildSessionUser(user));
        res.redirect(authConfig.clientOrigin);
      } catch {
        res.redirect(`${authConfig.clientOrigin}/login?error=session`);
      }
    },
  )(req, res, next);
}

// ---- Email magic link -------------------------------------------------------

const magicSchema = z.object({ email: z.string().min(3) });

router.post('/magic/request', loginLimiter, async (req, res) => {
  if (!providersEnabled().email) return fail(res, 404, 'Email sign-in is not configured');
  const parsed = magicSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'A valid email is required');
  const email = normalizeEmail(parsed.data.email);

  // Always return a generic success to avoid leaking which emails/domains exist.
  let devLink: string | undefined;
  if (isValidEmail(email) && isAllowedDomain(email)) {
    const token = createMagicToken(email);
    const url = `${authConfig.publicUrl}/api/auth/magic/verify?token=${encodeURIComponent(token)}`;
    if (authConfig.devMode) devLink = url; // surfaced only in dev, even if SMTP send fails
    try {
      await sendMagicLink(email, url);
    } catch (e) {
      console.error('[auth] failed to send magic link:', (e as Error).message);
    }
  }
  ok(res, { sent: true, ...(devLink ? { devLink } : {}) });
});

router.get('/magic/verify', async (req, res) => {
  const token = String(req.query.token || '');
  const email = verifyMagicToken(token);
  if (!email)
    return res.redirect(`${authConfig.clientOrigin}/login?error=${encodeURIComponent('Invalid or expired link')}`);
  try {
    const user = buildSessionUser(upsertUserOnLogin({ email }));
    await loginUser(req, user);
    res.redirect(authConfig.clientOrigin);
  } catch (e) {
    const reason = e instanceof AuthPolicyError ? e.message : 'Sign-in failed';
    res.redirect(`${authConfig.clientOrigin}/login?error=${encodeURIComponent(reason)}`);
  }
});

// ---- Invitation accept ------------------------------------------------------

// Acceptance is split into a non-mutating preview (GET) + an explicit action
// (POST) so that link unfurlers / prefetchers / login-CSRF cannot silently burn
// the single-use invite or create the membership before the human confirms.

// Non-mutating preview of the invite — safe for unfurl/prefetch. Public; the
// random token is the credential. Does NOT consume the invite.
router.get('/invite/info', (req, res) => {
  const token = String(req.query.token || '');
  const info = getInviteInfo(token);
  if (!info) return fail(res, 404, 'Invalid or expired invitation');
  ok(res, info);
});

// Explicit acceptance. Provisions the membership (tenant + role), marks the
// invite accepted, then signs the invitee in. Public like magic/dev-login (a
// pre-session login endpoint, so no requireCsrf); returns JSON, not a redirect.
const inviteAcceptSchema = z.object({ token: z.string().min(1) });

router.post('/invite/accept', async (req, res) => {
  const parsed = inviteAcceptSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'token is required');
  const grant = findValidInvite(parsed.data.token);
  if (!grant) return fail(res, 410, 'Invalid or expired invitation');
  try {
    const base = upsertUserOnLogin({ email: grant.email });
    setMembership(base.id, grant.tenant_id, grant.role);
    markInviteAccepted(grant.id);
    const user = buildSessionUser(base, grant.tenant_id);
    await loginUser(req, user);
    ok(res, { user, csrfToken: ensureCsrf(req) });
  } catch (e) {
    fail(res, 403, e instanceof AuthPolicyError ? e.message : 'Sign-in failed');
  }
});

// ---- Dev / offline login (only when AUTH_MODE=dev) --------------------------

const devSchema = z.object({
  email: z.string().min(3),
  name: z.string().optional(),
  role: z.enum(['Analyst', 'Admin', 'Submitter', 'Viewer']).optional(),
  tenant: z.string().optional(),
});

router.post('/dev-login', loginLimiter, async (req, res) => {
  if (!authConfig.devMode) return fail(res, 404, 'Dev login is disabled');
  const parsed = devSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'email is required');
  try {
    const base = upsertUserOnLogin({ email: parsed.data.email, name: parsed.data.name });
    const chosenRole = parsed.data.role ?? 'Analyst';
    // Make the global admin flag reflect the chosen role unconditionally, so a
    // later dev-login as a non-Admin role RESETS it (otherwise a one-time Admin
    // login would leave the user a permanent global admin).
    setUserAdmin(base.id, chosenRole === 'Admin');
    // Set up tenant context so the chosen role is consistent with resolveTenant:
    // Admin -> global flag (no membership); others -> membership in a dev tenant.
    let preferredTenant: number | null = null;
    if (chosenRole !== 'Admin') {
      const tenant = ensureTenant(parsed.data.tenant?.trim() || 'Dev Tenant');
      setMembership(base.id, tenant.id, chosenRole as 'Analyst' | 'Submitter' | 'Viewer');
      preferredTenant = tenant.id;
    }
    const sessionUser: SessionUser = buildSessionUser(base, preferredTenant);
    await loginUser(req, sessionUser);
    ok(res, { user: sessionUser, csrfToken: ensureCsrf(req) });
  } catch (e) {
    fail(res, 403, e instanceof AuthPolicyError ? e.message : 'Login failed');
  }
});

// ---- Sign out ---------------------------------------------------------------

router.post('/signout', async (req, res) => {
  await logoutUser(req);
  res.clearCookie('vrp.sid');
  ok(res, { signedOut: true });
});

export default router;
