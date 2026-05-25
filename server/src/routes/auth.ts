import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  authConfig,
  providersEnabled,
  upsertUserOnLogin,
  createMagicToken,
  verifyMagicToken,
  isAllowedDomain,
  isValidEmail,
  normalizeEmail,
  AuthPolicyError,
} from '../services/auth';
import { sendMagicLink } from '../services/mailer';
import { ensureCsrf, loginUser, logoutUser } from '../middleware/auth';
import type { Role, SessionUser } from '../types';
import { fail, ok } from './_helpers';

// Mounted at /api/auth — route paths here are relative to that.
const router = Router();

// Strict throttle for credential-submitting endpoints (login / email send),
// independent of the generous API-wide limiter.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

// ---- Session + provider discovery -----------------------------------------

router.get('/session', (req, res) => {
  const user = req.session.user ?? null;
  ok(res, { user, csrfToken: user ? ensureCsrf(req) : null });
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
        await loginUser(req, user);
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
  if (!email) return res.redirect(`${authConfig.clientOrigin}/login?error=${encodeURIComponent('Invalid or expired link')}`);
  try {
    const user = upsertUserOnLogin({ email });
    await loginUser(req, user);
    res.redirect(authConfig.clientOrigin);
  } catch (e) {
    const reason = e instanceof AuthPolicyError ? e.message : 'Sign-in failed';
    res.redirect(`${authConfig.clientOrigin}/login?error=${encodeURIComponent(reason)}`);
  }
});

// ---- Dev / offline login (only when AUTH_MODE=dev) --------------------------

const devSchema = z.object({
  email: z.string().min(3),
  name: z.string().optional(),
  role: z.enum(['Analyst', 'Admin', 'Viewer']).optional(),
});

router.post('/dev-login', loginLimiter, async (req, res) => {
  if (!authConfig.devMode) return fail(res, 404, 'Dev login is disabled');
  const parsed = devSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'email is required');
  try {
    const user = upsertUserOnLogin({ email: parsed.data.email, name: parsed.data.name });
    // In dev, allow choosing a role to exercise RBAC (session-only override).
    const sessionUser: SessionUser = parsed.data.role ? { ...user, role: parsed.data.role as Role } : user;
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
