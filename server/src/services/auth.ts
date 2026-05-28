import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, nowIso } from '../db';
import type { AuthProviders, Role, SessionUser, TenantMembership } from '../types';

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
  // Linear, ReDoS-free equivalent of /^[^\s@]+@[^\s@]+\.[^\s@]+$/ (the polynomial regex the
  // js/polynomial-redos query flagged): exactly one '@', no whitespace, a dot inside the domain.
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at < 1 || email.indexOf('@', at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
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
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    role: row.role,
    isAdmin: !!row.is_admin,
    memberships: [],
    activeTenantId: null,
  };
}

export function getUserByEmail(email: string): SessionUser | undefined {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
  return row ? mapUser(row) : undefined;
}

/** Live tenant memberships for a user (powers the session + tenant switcher). */
export function getMembershipsForUser(userId: number): TenantMembership[] {
  return db
    .prepare(
      `SELECT m.tenant_id, t.name AS tenant_name, m.role
       FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = ? ORDER BY t.name`,
    )
    .all(userId) as TenantMembership[];
}

export function isUserAdmin(userId: number): boolean {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
  return !!row?.is_admin;
}

/**
 * Enriches a base user record into a full session user with live admin flag,
 * memberships, and a resolved active tenant. The preferred active tenant is
 * honoured when the user still has access to it; otherwise it falls back to the
 * first membership (or null for admins / unprovisioned users).
 */
export function buildSessionUser(base: SessionUser, preferredActiveTenantId?: number | null): SessionUser {
  const isAdmin = isUserAdmin(base.id);
  const memberships = getMembershipsForUser(base.id);
  const preferred = preferredActiveTenantId === undefined ? (base.activeTenantId ?? null) : preferredActiveTenantId;
  let activeTenantId: number | null;
  if (isAdmin) {
    activeTenantId = preferred; // admin may stay in all-tenants mode (null) or pin a tenant
  } else if (preferred != null && memberships.some((m) => m.tenant_id === preferred)) {
    activeTenantId = preferred;
  } else {
    activeTenantId = memberships[0]?.tenant_id ?? null;
  }
  return { ...base, isAdmin, memberships, activeTenantId };
}

/**
 * Upserts a user at login time, enforcing the domain allow-list and (re)applying
 * the role policy. Throws AuthPolicyError if the email/domain is not permitted.
 * Admin-listed emails get the global admin flag set. Returns the base user;
 * callers wrap it with buildSessionUser to populate memberships/active tenant.
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

  // Admin-listed emails are global admins (a tenant-independent flag). Note this
  // only GRANTS admin on login; it never revokes — runtime revocation is owned by
  // the Admin page (PATCH /admin/users/:id). So we only set when allow-listed and
  // never clobber an Admin-page grant for OAuth/magic users. (Dev-login is the one
  // exception: it explicitly resets the flag to match its chosen role.)
  if (authConfig.adminEmails.includes(email)) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
  }

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
