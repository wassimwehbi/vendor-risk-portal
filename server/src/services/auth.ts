import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, nowIso } from '../db';
import type { AuthProviders, Role, SessionUser } from '../types';

/**
 * Authentication policy + user store.
 *
 * Identity is established by a provider (Google / Microsoft / email magic-link /
 * dev login) and then a server-side session is created. Role is ALWAYS derived
 * here from the user record / env policy — never from the client.
 */

function envList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const NODE_ENV = process.env.NODE_ENV || 'development';

export const authConfig = {
  // In production AUTH_SECRET is required; in dev we fall back to a fixed value
  // (logged as a warning) so the app still boots for the offline demo.
  secret: process.env.AUTH_SECRET || (NODE_ENV === 'production' ? '' : 'dev-insecure-secret-change-me'),
  // Dev login is enabled when AUTH_MODE=dev (defaults to enabled outside production).
  devMode: (process.env.AUTH_MODE || (NODE_ENV === 'production' ? 'production' : 'dev')) === 'dev',
  allowedDomains: envList('ALLOWED_EMAIL_DOMAINS'),
  adminEmails: envList('ADMIN_EMAILS'),
  defaultRole: ((): Role => {
    const r = (process.env.DEFAULT_ROLE || 'Analyst') as Role;
    return r === 'Admin' || r === 'Viewer' || r === 'Analyst' ? r : 'Analyst';
  })(),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4100}`,
  google: { id: process.env.GOOGLE_CLIENT_ID || '', secret: process.env.GOOGLE_CLIENT_SECRET || '' },
  microsoft: {
    id: process.env.MICROSOFT_CLIENT_ID || '',
    secret: process.env.MICROSOFT_CLIENT_SECRET || '',
    tenant: process.env.MICROSOFT_TENANT || 'common',
  },
  smtpConfigured: Boolean(process.env.SMTP_HOST),
  magicTokenTtlMs: 15 * 60 * 1000,
};

export function providersEnabled(): AuthProviders {
  return {
    google: Boolean(authConfig.google.id && authConfig.google.secret),
    microsoft: Boolean(authConfig.microsoft.id && authConfig.microsoft.secret),
    // Magic-link is offered when SMTP is configured, or in dev mode (where the
    // link is logged / returned for testing instead of emailed).
    email: authConfig.smtpConfigured || authConfig.devMode,
    dev: authConfig.devMode,
  };
}

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Whether an email's domain is permitted (empty allow-list = allow all). */
export function isAllowedDomain(email: string): boolean {
  if (authConfig.allowedDomains.length === 0) return true;
  const domain = normalizeEmail(email).split('@')[1] || '';
  return authConfig.allowedDomains.includes(domain);
}

/** Role policy: admin allow-list wins; otherwise keep existing role or use the default. */
export function resolveRole(email: string, existingRole?: Role): Role {
  if (authConfig.adminEmails.includes(normalizeEmail(email))) return 'Admin';
  return existingRole ?? authConfig.defaultRole;
}

export class AuthPolicyError extends Error {}

function mapUser(row: any): SessionUser {
  return { id: row.id, email: row.email, name: row.name ?? null, role: row.role };
}

export function getUserByEmail(email: string): SessionUser | undefined {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
  return row ? mapUser(row) : undefined;
}

/**
 * Upserts a user at login time, enforcing the domain allow-list and (re)applying
 * the role policy. Throws AuthPolicyError if the email/domain is not permitted.
 */
export function upsertUserOnLogin(input: { email: string; name?: string | null }): SessionUser {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new AuthPolicyError('A valid email address is required.');
  if (!isAllowedDomain(email)) throw new AuthPolicyError('Your email domain is not permitted to sign in.');

  const role = resolveRole(email, getUserByEmail(email)?.role);
  const now = nowIso();

  // Atomic upsert keyed on the unique email (avoids a read-then-insert race).
  db.prepare(
    `INSERT INTO users (email, name, role, created_at, last_login)
     VALUES (@email, @name, @role, @now, @now)
     ON CONFLICT(email) DO UPDATE SET
       name = COALESCE(excluded.name, users.name),
       role = excluded.role,
       last_login = excluded.last_login`,
  ).run({ email, name: input.name ?? null, role, now });

  return getUserByEmail(email)!;
}

// ---- Stateless magic-link tokens (HMAC-signed, short-lived) ----------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', authConfig.secret).update(payload).digest('base64url');
}

/** token = base64url(JSON{email,exp}).base64url(HMAC) */
export function createMagicToken(email: string): string {
  const payload = JSON.stringify({ email: normalizeEmail(email), exp: Date.now() + authConfig.magicTokenTtlMs });
  const body = b64url(payload);
  return `${body}.${sign(body)}`;
}

export function verifyMagicToken(token: string): string | null {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof email !== 'string' || typeof exp !== 'number' || Date.now() > exp) return null;
    return email;
  } catch {
    return null;
  }
}
