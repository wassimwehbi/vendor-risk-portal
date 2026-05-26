import { db, mapAssessment, mapAudit, mapEvidence, mapFinding, mapItem, mapVendor, nowIso } from '../db';
import type {
  Assessment,
  AssessmentDetail,
  AuditEntry,
  EvidenceFile,
  EvidenceKind,
  EvidenceParseStatus,
  Finding,
  FrameworkMapping,
  NewQuestionnaireItem,
  QuestionnaireItem,
  ReportData,
  RiskLevel,
  Vendor,
} from '../types';
import { effectiveFinding } from '../types';
import type { AccessScope } from '../routes/_helpers';
import { logAudit } from './audit';

// ---- Scope helpers ---------------------------------------------------------

/** Tenant predicate. Omitted only for an admin in "all tenants" mode. */
function tenantClause(scope: AccessScope, alias = 'a'): { sql: string; params: unknown[] } {
  if (scope.isAdmin && scope.activeTenantId == null) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.tenant_id = ?`, params: [scope.activeTenantId] };
}

/** Ownership predicate — restricts Submitters to assessments they created. */
function ownClause(scope: AccessScope, alias = 'a'): { sql: string; params: unknown[] } {
  if (!scope.ownOnly) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.created_by = ?`, params: [scope.actor] };
}

/** Writes require a concrete tenant; an admin must select one first. */
function activeTenantOrThrow(scope: AccessScope): number {
  if (scope.activeTenantId == null) {
    throw new Error('Select a tenant before performing this action.');
  }
  return scope.activeTenantId;
}

// ---- Vendors ---------------------------------------------------------------

export function listVendors(scope: AccessScope): Vendor[] {
  const t = tenantClause(scope, 'vendors');
  return db
    .prepare(`SELECT * FROM vendors WHERE 1=1${t.sql} ORDER BY name`)
    .all(...t.params)
    .map(mapVendor);
}

function findOrCreateVendor(name: string, tenantId: number): number {
  const existing = db.prepare('SELECT id FROM vendors WHERE name = ? AND tenant_id = ?').get(name, tenantId) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare('INSERT INTO vendors (name, tenant_id, created_at) VALUES (?, ?, ?)')
    .run(name, tenantId, nowIso());
  return Number(info.lastInsertRowid);
}

// ---- Assessments -----------------------------------------------------------

const ASSESSMENT_SELECT = `
  SELECT a.*, v.name AS vendor_name,
    (SELECT COUNT(*) FROM questionnaire_items qi WHERE qi.assessment_id = a.id) AS item_count,
    (SELECT COUNT(*) FROM findings f WHERE f.assessment_id = a.id) AS finding_count
  FROM assessments a
  JOIN vendors v ON v.id = a.vendor_id
`;

export function listAssessments(scope: AccessScope): Assessment[] {
  const t = tenantClause(scope);
  const o = ownClause(scope);
  return db
    .prepare(`${ASSESSMENT_SELECT} WHERE 1=1${t.sql}${o.sql} ORDER BY a.created_at DESC`)
    .all(...t.params, ...o.params)
    .map(mapAssessment);
}

/**
 * Fetches a single assessment, enforcing tenant (and, for Submitters, ownership)
 * scope. Returns undefined for cross-tenant / non-owned ids so callers respond
 * 404 (existence is never leaked).
 */
export function getAssessment(id: number, scope: AccessScope): Assessment | undefined {
  const t = tenantClause(scope);
  const o = ownClause(scope);
  const row = db.prepare(`${ASSESSMENT_SELECT} WHERE a.id = ?${t.sql}${o.sql}`).get(id, ...t.params, ...o.params);
  return row ? mapAssessment(row) : undefined;
}

export interface CreateAssessmentInput {
  vendor_name: string;
  questionnaire_type: string;
  date_submitted: string;
}

export function createAssessment(input: CreateAssessmentInput, scope: AccessScope): Assessment {
  const tenantId = activeTenantOrThrow(scope);
  const vendorId = findOrCreateVendor(input.vendor_name.trim(), tenantId);
  const info = db
    .prepare(
      `INSERT INTO assessments (vendor_id, tenant_id, created_by, questionnaire_type, date_submitted, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'uploaded', ?)`,
    )
    .run(vendorId, tenantId, scope.actor, input.questionnaire_type, input.date_submitted, nowIso());
  const id = Number(info.lastInsertRowid);
  logAudit({
    assessment_id: id,
    tenant_id: tenantId,
    action: 'assessment_created',
    actor: scope.actor,
    role: scope.effectiveRole,
    details: { vendor_name: input.vendor_name },
  });
  return getAssessment(id, scope)!;
}

export function getAssessmentDetail(id: number, scope: AccessScope): AssessmentDetail | undefined {
  const assessment = getAssessment(id, scope);
  if (!assessment) return undefined;
  const items = db
    .prepare('SELECT * FROM questionnaire_items WHERE assessment_id = ? ORDER BY id')
    .all(id)
    .map(mapItem);
  const findings = db.prepare('SELECT * FROM findings WHERE assessment_id = ? ORDER BY id').all(id).map(mapFinding);
  const evidence = db
    .prepare('SELECT * FROM evidence_files WHERE assessment_id = ? ORDER BY id')
    .all(id)
    .map(mapEvidence);
  return { assessment, items, findings, evidence };
}

// ---- Questionnaire items + evidence ---------------------------------------

export function replaceItems(
  assessmentId: number,
  items: NewQuestionnaireItem[],
  scope: AccessScope,
): QuestionnaireItem[] {
  // Authorize against (and derive the tenant from) the existing assessment, so
  // an admin in all-tenants mode can write without first pinning a tenant.
  const assessment = getAssessment(assessmentId, scope);
  if (!assessment) throw new Error('Assessment not found');
  const tenantId = assessment.tenant_id!;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM findings WHERE assessment_id = ?').run(assessmentId);
    db.prepare('DELETE FROM questionnaire_items WHERE assessment_id = ?').run(assessmentId);
    const insert = db.prepare(`
      INSERT INTO questionnaire_items
        (assessment_id, question_id, question_text, response, response_type,
         evidence_text, evidence_location, vendor_comments, relevant_date, expiration_date)
      VALUES
        (@assessment_id, @question_id, @question_text, @response, @response_type,
         @evidence_text, @evidence_location, @vendor_comments, @relevant_date, @expiration_date)
    `);
    for (const it of items) {
      insert.run({ assessment_id: assessmentId, ...it });
    }
    // New questionnaire content invalidates prior analysis and any prior approval.
    db.prepare(
      `UPDATE assessments
       SET status = 'extracted', overall_risk = NULL, ai_engine_used = NULL,
           validation_status = 'pending', validated_by = NULL, validated_at = NULL
       WHERE id = ?`,
    ).run(assessmentId);
  });
  tx();
  logAudit({
    assessment_id: assessmentId,
    tenant_id: tenantId,
    action: 'items_extracted',
    actor: scope.actor,
    role: scope.effectiveRole,
    details: { count: items.length },
  });
  return db
    .prepare('SELECT * FROM questionnaire_items WHERE assessment_id = ? ORDER BY id')
    .all(assessmentId)
    .map(mapItem);
}

export interface NewEvidence {
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
  kind: EvidenceKind;
  parse_status: EvidenceParseStatus;
  extracted_chars: number;
  extracted_text: string | null;
  parse_note: string | null;
}

export function addEvidenceFiles(assessmentId: number, files: NewEvidence[], scope: AccessScope): EvidenceFile[] {
  // Authorize against (and derive the tenant from) the existing assessment, so
  // an admin in all-tenants mode can write without first pinning a tenant.
  const assessment = getAssessment(assessmentId, scope);
  if (!assessment) throw new Error('Assessment not found');
  const tenantId = assessment.tenant_id!;
  const insert = db.prepare(`
    INSERT INTO evidence_files
      (assessment_id, original_name, stored_name, mime_type, size, uploaded_at,
       kind, parse_status, extracted_chars, extracted_text, parse_note)
    VALUES
      (@assessment_id, @original_name, @stored_name, @mime_type, @size, @uploaded_at,
       @kind, @parse_status, @extracted_chars, @extracted_text, @parse_note)
  `);
  const ts = nowIso();
  const tx = db.transaction(() => {
    for (const f of files) {
      insert.run({ assessment_id: assessmentId, uploaded_at: ts, ...f });
    }
  });
  tx();
  if (files.length > 0) {
    logAudit({
      assessment_id: assessmentId,
      tenant_id: tenantId,
      action: 'evidence_uploaded',
      actor: scope.actor,
      role: scope.effectiveRole,
      details: {
        files: files.map((f) => ({
          name: f.original_name,
          kind: f.kind,
          parse_status: f.parse_status,
          extracted_chars: f.extracted_chars,
        })),
        extracted: files.filter((f) => f.parse_status === 'extracted').length,
        total: files.length,
      },
    });
  }
  return db
    .prepare('SELECT * FROM evidence_files WHERE assessment_id = ? ORDER BY id')
    .all(assessmentId)
    .map(mapEvidence);
}

// ---- Human-in-the-loop updates --------------------------------------------

export interface FindingPatch {
  control_domain?: string;
  framework_mappings?: FrameworkMapping[];
  risk_level?: RiskLevel;
  evidence_sufficiency?: Finding['evidence_sufficiency'];
  follow_up_questions?: string[];
  analyst_status?: Finding['analyst_status'];
}

export function patchFinding(id: number, patch: FindingPatch, scope: AccessScope): Finding | undefined {
  const t = tenantClause(scope);
  const o = ownClause(scope);
  // Join finding -> assessment so the tenant/ownership scope is enforced, and
  // project the assessment's tenant so the audit is stamped with it (this lets
  // an admin in all-tenants mode write without first pinning a tenant).
  const row = db
    .prepare(
      `SELECT f.*, a.tenant_id AS _tenant_id FROM findings f JOIN assessments a ON a.id = f.assessment_id WHERE f.id = ?${t.sql}${o.sql}`,
    )
    .get(id, ...t.params, ...o.params) as (Record<string, unknown> & { _tenant_id: number }) | undefined;
  if (!row) return undefined;
  const tenantId = row._tenant_id;
  const finding = mapFinding(row);

  let analystValues = { ...(finding.analyst_values ?? {}) } as NonNullable<Finding['analyst_values']>;
  const overrideKeys: (keyof FindingPatch)[] = [
    'control_domain',
    'framework_mappings',
    'risk_level',
    'evidence_sufficiency',
    'follow_up_questions',
  ];
  for (const key of overrideKeys) {
    if (patch[key] !== undefined) (analystValues as any)[key] = patch[key];
  }

  let status: Finding['analyst_status'] = patch.analyst_status ?? finding.analyst_status;
  if (status === 'accepted') {
    // Accepting the AI result clears any prior overrides.
    analystValues = {};
  } else if (Object.keys(analystValues).length > 0) {
    status = 'overridden';
  }

  const storedValues = Object.keys(analystValues).length > 0 ? JSON.stringify(analystValues) : null;
  db.prepare('UPDATE findings SET analyst_values = ?, analyst_status = ?, updated_at = ? WHERE id = ?').run(
    storedValues,
    status,
    nowIso(),
    id,
  );

  logAudit({
    assessment_id: finding.assessment_id,
    tenant_id: tenantId,
    action: 'finding_updated',
    actor: scope.actor,
    role: scope.effectiveRole,
    details: { finding_id: id, analyst_status: status, overrides: analystValues },
  });

  const updated = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
  return mapFinding(updated);
}

export interface AssessmentPatch {
  overall_risk?: RiskLevel;
  analyst_notes?: string;
  validation_status?: 'pending' | 'approved';
}

export function patchAssessment(id: number, patch: AssessmentPatch, scope: AccessScope): Assessment | undefined {
  // Authorize against (and derive the tenant from) the existing assessment, so
  // an admin in all-tenants mode can write without first pinning a tenant.
  const current = getAssessment(id, scope);
  if (!current) return undefined;
  const tenantId = current.tenant_id!;

  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  if (patch.overall_risk !== undefined) {
    sets.push('overall_risk = @overall_risk');
    params.overall_risk = patch.overall_risk;
  }
  if (patch.analyst_notes !== undefined) {
    sets.push('analyst_notes = @analyst_notes');
    params.analyst_notes = patch.analyst_notes;
  }
  if (patch.validation_status !== undefined) {
    sets.push('validation_status = @validation_status');
    params.validation_status = patch.validation_status;
    if (patch.validation_status === 'approved') {
      sets.push("status = 'approved'", 'validated_by = @validated_by', 'validated_at = @validated_at');
      params.validated_by = scope.actor;
      params.validated_at = nowIso();
    } else {
      sets.push('validated_by = NULL', 'validated_at = NULL');
    }
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE assessments SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  logAudit({
    assessment_id: id,
    tenant_id: tenantId,
    action: patch.validation_status === 'approved' ? 'assessment_approved' : 'assessment_updated',
    actor: scope.actor,
    role: scope.effectiveRole,
    details: patch as Record<string, unknown>,
  });

  return getAssessment(id, scope);
}

// ---- Audit + report --------------------------------------------------------

// Callers must verify access to the assessment (via getAssessment) before
// reading its audit trail.
export function listAudit(assessmentId: number): AuditEntry[] {
  return db.prepare('SELECT * FROM audit_log WHERE assessment_id = ? ORDER BY id').all(assessmentId).map(mapAudit);
}

export function buildReport(id: number, scope: AccessScope): ReportData | undefined {
  const detail = getAssessmentDetail(id, scope);
  if (!detail) return undefined;
  const { assessment, items, findings } = detail;
  const itemsById = new Map<number, QuestionnaireItem>(items.map((i) => [i.id, i]));

  const controls: ReportData['controls'] = [];
  const weak_or_missing: Finding[] = [];
  const evidence_gaps: Finding[] = [];
  const followUpSet: string[] = [];

  for (const f of findings) {
    const item = itemsById.get(f.item_id);
    if (item) controls.push({ item, finding: f });
    const eff = effectiveFinding(f);
    if (
      eff.risk_level === 'High' ||
      eff.risk_level === 'Critical' ||
      f.control_strength === 'None' ||
      f.control_strength === 'Weak' ||
      f.completeness === 'Missing' ||
      f.completeness === 'Vague'
    ) {
      weak_or_missing.push(f);
    }
    if (['None', 'Expired', 'Insufficient', 'Misaligned'].includes(eff.evidence_sufficiency)) {
      evidence_gaps.push(f);
    }
    for (const q of eff.follow_up_questions) if (!followUpSet.includes(q)) followUpSet.push(q);
  }

  return {
    vendor_name: assessment.vendor_name,
    questionnaire_type: assessment.questionnaire_type,
    date_submitted: assessment.date_submitted,
    data_categories: assessment.data_categories,
    applicable_frameworks: assessment.applicable_frameworks,
    controls,
    weak_or_missing,
    evidence_gaps,
    overall_risk: assessment.overall_risk,
    follow_ups: followUpSet,
    analyst_notes: assessment.analyst_notes,
    validation_status: assessment.validation_status,
    validated_by: assessment.validated_by,
    validated_at: assessment.validated_at,
    ai_engine_used: assessment.ai_engine_used,
    mapping_version: assessment.mapping_version,
    generated_at: nowIso(),
  };
}
