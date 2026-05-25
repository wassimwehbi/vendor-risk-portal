import type { Request, Response } from 'express';
import type { Role } from '../types';

/**
 * Derives the acting identity from the authenticated session. Roles come from
 * the server-side user record — never from client-supplied headers. `requireAuth`
 * runs before feature routes, so `req.session.user` is present in practice; the
 * fallback is a safe, powerless default.
 */
export function getContext(req: Request): { actor: string; role: Role } {
  const user = req.session?.user;
  if (user) return { actor: user.email, role: user.role };
  return { actor: 'system', role: 'Viewer' };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

export function parseId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
