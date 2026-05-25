import { db, nowIso } from '../db';
import type { Role } from '../types';

export interface AuditInput {
  assessment_id: number;
  action: string;
  actor: string;
  role: Role;
  details?: Record<string, unknown>;
}

/**
 * Appends an immutable entry to the audit log. Every state change in the system
 * (upload, analysis, analyst override, approval) must be recorded here.
 */
export function logAudit(entry: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (assessment_id, action, actor, role, details, created_at)
     VALUES (@assessment_id, @action, @actor, @role, @details, @created_at)`
  ).run({
    assessment_id: entry.assessment_id,
    action: entry.action,
    actor: entry.actor,
    role: entry.role,
    details: entry.details ? JSON.stringify(entry.details) : null,
    created_at: nowIso(),
  });
}
