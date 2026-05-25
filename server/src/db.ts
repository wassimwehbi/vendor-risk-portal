import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  Assessment,
  AuditEntry,
  EvidenceFile,
  Finding,
  QuestionnaireItem,
  Vendor,
} from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DB lives in the server directory (src/..). Overridable via VRP_DB_PATH (used by tests).
const DB_PATH = process.env.VRP_DB_PATH || join(__dirname, '..', 'vendor-risk.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id INTEGER NOT NULL,
      questionnaire_type TEXT NOT NULL,
      date_submitted TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      data_categories TEXT NOT NULL DEFAULT '[]',
      applicable_frameworks TEXT NOT NULL DEFAULT '[]',
      overall_risk TEXT,
      ai_engine_used TEXT,
      analyst_notes TEXT,
      validation_status TEXT NOT NULL DEFAULT 'pending',
      validated_by TEXT,
      validated_at TEXT,
      mapping_version TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );

    CREATE TABLE IF NOT EXISTS questionnaire_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      response TEXT NOT NULL DEFAULT '',
      response_type TEXT NOT NULL DEFAULT 'FreeText',
      evidence_text TEXT,
      evidence_location TEXT,
      vendor_comments TEXT,
      relevant_date TEXT,
      expiration_date TEXT,
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      assessment_id INTEGER NOT NULL,
      control_domain TEXT NOT NULL,
      framework_mappings TEXT NOT NULL DEFAULT '[]',
      ai_finding TEXT NOT NULL DEFAULT '',
      completeness TEXT NOT NULL DEFAULT 'Partial',
      control_strength TEXT NOT NULL DEFAULT 'Medium',
      evidence_sufficiency TEXT NOT NULL DEFAULT 'None',
      risk_level TEXT NOT NULL DEFAULT 'Medium',
      follow_up_questions TEXT NOT NULL DEFAULT '[]',
      ai_rationale TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'rule',
      analyst_status TEXT NOT NULL DEFAULT 'pending',
      analyst_values TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES questionnaire_items(id),
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    CREATE TABLE IF NOT EXISTS evidence_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY (assessment_id) REFERENCES assessments(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      role TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_assessment ON questionnaire_items(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_findings_assessment ON findings(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_findings_item ON findings(item_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_assessment ON evidence_files(assessment_id);
    CREATE INDEX IF NOT EXISTS idx_audit_assessment ON audit_log(assessment_id);
  `);
}

initDb();

// ---- Row -> typed object mappers ------------------------------------------

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function mapVendor(row: any): Vendor {
  return { id: row.id, name: row.name, created_at: row.created_at };
}

export function mapAssessment(row: any): Assessment {
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name ?? '',
    questionnaire_type: row.questionnaire_type,
    date_submitted: row.date_submitted,
    status: row.status,
    data_categories: parseJson(row.data_categories, []),
    applicable_frameworks: parseJson(row.applicable_frameworks, []),
    overall_risk: row.overall_risk ?? null,
    ai_engine_used: row.ai_engine_used ?? null,
    analyst_notes: row.analyst_notes ?? null,
    validation_status: row.validation_status,
    validated_by: row.validated_by ?? null,
    validated_at: row.validated_at ?? null,
    mapping_version: row.mapping_version ?? null,
    created_at: row.created_at,
    item_count: row.item_count,
    finding_count: row.finding_count,
  };
}

export function mapItem(row: any): QuestionnaireItem {
  return {
    id: row.id,
    assessment_id: row.assessment_id,
    question_id: row.question_id,
    question_text: row.question_text,
    response: row.response,
    response_type: row.response_type,
    evidence_text: row.evidence_text ?? null,
    evidence_location: row.evidence_location ?? null,
    vendor_comments: row.vendor_comments ?? null,
    relevant_date: row.relevant_date ?? null,
    expiration_date: row.expiration_date ?? null,
  };
}

export function mapFinding(row: any): Finding {
  return {
    id: row.id,
    item_id: row.item_id,
    assessment_id: row.assessment_id,
    control_domain: row.control_domain,
    framework_mappings: parseJson(row.framework_mappings, []),
    ai_finding: row.ai_finding,
    completeness: row.completeness,
    control_strength: row.control_strength,
    evidence_sufficiency: row.evidence_sufficiency,
    risk_level: row.risk_level,
    follow_up_questions: parseJson(row.follow_up_questions, []),
    ai_rationale: row.ai_rationale,
    source: row.source,
    analyst_status: row.analyst_status,
    analyst_values: parseJson(row.analyst_values, null as any),
    updated_at: row.updated_at,
  };
}

export function mapEvidence(row: any): EvidenceFile {
  return {
    id: row.id,
    assessment_id: row.assessment_id,
    original_name: row.original_name,
    stored_name: row.stored_name,
    mime_type: row.mime_type,
    size: row.size,
    uploaded_at: row.uploaded_at,
  };
}

export function mapAudit(row: any): AuditEntry {
  return {
    id: row.id,
    assessment_id: row.assessment_id,
    action: row.action,
    actor: row.actor,
    role: row.role,
    details: parseJson(row.details, null as any),
    created_at: row.created_at,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
