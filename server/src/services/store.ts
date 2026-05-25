import {
  db,
  mapAssessment,
  mapAudit,
  mapEvidence,
  mapFinding,
  mapItem,
  mapVendor,
  nowIso,
} from '../db';
import type {
  Assessment,
  AssessmentDetail,
  AuditEntry,
  EvidenceFile,
  Finding,
  FrameworkMapping,
  NewQuestionnaireItem,
  QuestionnaireItem,
  ReportData,
  RiskLevel,
  Role,
  Vendor,
} from '../types';
import { effectiveFinding } from '../types';
import { logAudit } from './audit';

// ---- Vendors ---------------------------------------------------------------

export function listVendors(): Vendor[] {
  return db.prepare('SELECT * FROM vendors ORDER BY name').all().map(mapVendor);
}

function findOrCreateVendor(name: string): number {
  const existing = db.prepare('SELECT * FROM vendors WHERE name = ?').get(name) as any;
  if (existing) return existing.id;
  const info = db
    .prepare('INSERT INTO vendors (name, created_at) VALUES (?, ?)')
    .run(name, nowIso());
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

export function listAssessments(): Assessment[] {
  return db.prepare(`${ASSESSMENT_SELECT} ORDER BY a.created_at DESC`).all().map(mapAssessment);
}

export function getAssessment(id: number): Assessment | undefined {
  const row = db.prepare(`${ASSESSMENT_SELECT} WHERE a.id = ?`).get(id);
  return row ? mapAssessment(row) : undefined;
}

export interface CreateAssessmentInput {
  vendor_name: string;
  questionnaire_type: string;
  date_submitted: string;
}

export function createAssessment(input: CreateAssessmentInput, actor: string, role: Role): Assessment {
  const vendorId = findOrCreateVendor(input.vendor_name.trim());
  const info = db
    .prepare(
      `INSERT INTO assessments (vendor_id, questionnaire_type, date_submitted, status, created_at)
       VALUES (?, ?, ?, 'uploaded', ?)`
    )
    .run(vendorId, input.questionnaire_type, input.date_submitted, nowIso());
  const id = Number(info.lastInsertRowid);
  logAudit({ assessment_id: id, action: 'assessment_created', actor, role, details: { vendor_name: input.vendor_name } });
  return getAssessment(id)!;
}

export function getAssessmentDetail(id: number): AssessmentDetail | undefined {
  const assessment = getAssessment(id);
  if (!assessment) return undefined;
  const items = db.prepare('SELECT * FROM questionnaire_items WHERE assessment_id = ? ORDER BY id').all(id).map(mapItem);
  const findings = db.prepare('SELECT * FROM findings WHERE assessment_id = ? ORDER BY id').all(id).map(mapFinding);
  const evidence = db.prepare('SELECT * FROM evidence_files WHERE assessment_id = ? ORDER BY id').all(id).map(mapEvidence);
  return { assessment, items, findings, evidence };
}

// ---- Questionnaire items + evidence ---------------------------------------

export function replaceItems(assessmentId: number, items: NewQuestionnaireItem[], actor: string, role: Role): QuestionnaireItem[] {
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
       WHERE id = ?`
    ).run(assessmentId);
  });
  tx();
  logAudit({ assessment_id: assessmentId, action: 'items_extracted', actor, role, details: { count: items.length } });
  return db.prepare('SELECT * FROM questionnaire_items WHERE assessment_id = ? ORDER BY id').all(assessmentId).map(mapItem);
}

export interface NewEvidence {
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
}

export function addEvidenceFiles(assessmentId: number, files: NewEvidence[], actor: string, role: Role): EvidenceFile[] {
  const insert = db.prepare(`
    INSERT INTO evidence_files (assessment_id, original_name, stored_name, mime_type, size, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const f of files) {
      insert.run(assessmentId, f.original_name, f.stored_name, f.mime_type, f.size, nowIso());
    }
  });
  tx();
  if (files.length > 0) {
    logAudit({ assessment_id: assessmentId, action: 'evidence_uploaded', actor, role, details: { files: files.map((f) => f.original_name) } });
  }
  return db.prepare('SELECT * FROM evidence_files WHERE assessment_id = ? ORDER BY id').all(assessmentId).map(mapEvidence);
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

export function patchFinding(id: number, patch: FindingPatch, actor: string, role: Role): Finding | undefined {
  const row = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
  if (!row) return undefined;
  const finding = mapFinding(row);

  let analystValues = { ...(finding.analyst_values ?? {}) } as NonNullable<Finding['analyst_values']>;
  const overrideKeys: (keyof FindingPatch)[] = ['control_domain', 'framework_mappings', 'risk_level', 'evidence_sufficiency', 'follow_up_questions'];
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
    action: 'finding_updated',
    actor,
    role,
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

export function patchAssessment(id: number, patch: AssessmentPatch, actor: string, role: Role): Assessment | undefined {
  const current = getAssessment(id);
  if (!current) return undefined;

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
      params.validated_by = actor;
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
    action: patch.validation_status === 'approved' ? 'assessment_approved' : 'assessment_updated',
    actor,
    role,
    details: patch as Record<string, unknown>,
  });

  return getAssessment(id);
}

// ---- Audit + report --------------------------------------------------------

export function listAudit(assessmentId: number): AuditEntry[] {
  return db.prepare('SELECT * FROM audit_log WHERE assessment_id = ? ORDER BY id').all(assessmentId).map(mapAudit);
}

export function buildReport(id: number): ReportData | undefined {
  const detail = getAssessmentDetail(id);
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
    if (eff.risk_level === 'High' || eff.risk_level === 'Critical' || f.control_strength === 'None' || f.control_strength === 'Weak' || f.completeness === 'Missing' || f.completeness === 'Vague') {
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
