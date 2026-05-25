import { createHash, randomBytes } from 'node:crypto';
import { db, nowIso } from '../db';
import type { Invite, MembershipRole } from '../types';

// Invite links are opened later (from an email/chat), so they live days, not
// the 15 minutes of an immediate magic-link sign-in.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mapInvite(row: any): Invite {
  return {
    id: row.id,
    email: row.email,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    role: row.role,
    invited_by: row.invited_by,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

export interface CreatedInvite {
  invite: Invite;
  token: string; // raw token — returned ONCE; only its hash is stored
}

export function createInvite(input: {
  email: string;
  tenantId: number;
  role: MembershipRole;
  invitedBy: string;
}): CreatedInvite {
  const email = input.email.trim().toLowerCase();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const tx = db.transaction(() => {
    // One pending invite per (email, tenant): replace any prior unaccepted one.
    db.prepare('DELETE FROM invites WHERE email = ? AND tenant_id = ? AND accepted_at IS NULL').run(email, input.tenantId);
    db.prepare(
      `INSERT INTO invites (email, tenant_id, role, token_hash, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(email, input.tenantId, input.role, tokenHash, input.invitedBy, now, expiresAt);
  });
  tx();

  const row = db
    .prepare('SELECT i.*, t.name AS tenant_name FROM invites i JOIN tenants t ON t.id = i.tenant_id WHERE i.token_hash = ?')
    .get(tokenHash);
  return { invite: mapInvite(row), token };
}

export function listPendingInvites(): Invite[] {
  return db
    .prepare(
      `SELECT i.*, t.name AS tenant_name FROM invites i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.accepted_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`,
    )
    .all(nowIso())
    .map(mapInvite);
}

export function revokeInvite(id: number): boolean {
  return db.prepare('DELETE FROM invites WHERE id = ? AND accepted_at IS NULL').run(id).changes > 0;
}

export interface InviteGrant {
  id: number;
  email: string;
  tenant_id: number;
  role: MembershipRole;
}

/** Resolves a raw token to a valid (unaccepted, unexpired) invite, or null. */
export function findValidInvite(token: string): InviteGrant | null {
  if (!token) return null;
  const row = db
    .prepare('SELECT id, email, tenant_id, role, expires_at, accepted_at FROM invites WHERE token_hash = ?')
    .get(hashToken(token)) as
    | { id: number; email: string; tenant_id: number; role: MembershipRole; expires_at: string; accepted_at: string | null }
    | undefined;
  if (!row || row.accepted_at || row.expires_at <= nowIso()) return null;
  return { id: row.id, email: row.email, tenant_id: row.tenant_id, role: row.role };
}

/**
 * Non-consuming preview of a valid invite (powers the client confirmation page).
 * Applies the same validity checks as findValidInvite but JOINs tenants for a
 * display name and does NOT mark the invite accepted. Returns null if invalid.
 */
export function getInviteInfo(token: string): { email: string; tenant_name: string; role: MembershipRole } | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT i.email, i.role, i.expires_at, i.accepted_at, t.name AS tenant_name
       FROM invites i JOIN tenants t ON t.id = i.tenant_id WHERE i.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | { email: string; role: MembershipRole; expires_at: string; accepted_at: string | null; tenant_name: string }
    | undefined;
  if (!row || row.accepted_at || row.expires_at <= nowIso()) return null;
  return { email: row.email, tenant_name: row.tenant_name, role: row.role };
}

export function markInviteAccepted(id: number): void {
  db.prepare('UPDATE invites SET accepted_at = ? WHERE id = ?').run(nowIso(), id);
}
