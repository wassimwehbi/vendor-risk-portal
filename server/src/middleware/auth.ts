import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SessionUser } from '../types';

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

/** Returns the session CSRF token, creating one if absent. */
export function ensureCsrf(req: Request): string {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(24).toString('base64url');
  return req.session.csrfToken;
}

/** Constant-time string comparison (avoids leaking via timing). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Rejects unauthenticated requests (no established session user). */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.user) return next();
  fail(res, 401, 'Authentication required');
}

/**
 * CSRF guard for state-changing requests. Because the session cookie is
 * SameSite and CORS is locked to the known client origin, requiring a per-session
 * token in a custom header (which a cross-site form cannot set) blocks CSRF.
 * Safe (GET/HEAD/OPTIONS) methods pass through.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.header('x-csrf-token');
  if (header && req.session.csrfToken && safeEqual(header, req.session.csrfToken)) return next();
  fail(res, 403, 'Invalid or missing CSRF token');
}

/** Establishes a fresh authenticated session (regenerates id to prevent fixation). */
export function loginUser(req: Request, user: SessionUser): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = user;
      ensureCsrf(req);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

export function logoutUser(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}
