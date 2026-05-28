// Shared client/server contract for the Vendor Risk Questionnaire Analysis Tool.
// The client keeps a copy of these types in client/src/types.ts.

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ResponseType = 'Yes' | 'No' | 'Partial' | 'N/A' | 'FreeText';
export type ControlStrength = 'Strong' | 'Medium' | 'Weak' | 'None';
export type EvidenceSufficiency = 'Sufficient' | 'Insufficient' | 'None' | 'Expired' | 'Misaligned';
export type Completeness = 'Complete' | 'Partial' | 'Vague' | 'Missing';
export type AnalystStatus = 'pending' | 'accepted' | 'overridden';
export type AssessmentStatus = 'uploaded' | 'extracted' | 'analyzed' | 'approved';
export type ValidationStatus = 'pending' | 'approved';
export type AiEngine = 'claude' | 'rule';
export type Role = 'Analyst' | 'Admin' | 'Viewer' | 'Submitter';
// Roles that can be assigned per tenant. 'Admin' is a GLOBAL flag, never a membership role.
export type MembershipRole = 'Analyst' | 'Viewer' | 'Submitter';

// ---- Multi-tenancy ---------------------------------------------------------

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  member_count?: number;
}

// A user's role within a single tenant (powers the tenant switcher + scoping).
export interface TenantMembership {
  tenant_id: number;
  tenant_name: string;
  role: MembershipRole;
}

// Authenticated user (server session) + which sign-in methods are enabled.
// Authorization is derived from `isAdmin` (global) and the membership role for
// the `activeTenantId` — never from the client.
export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
  role: Role; // legacy/global role; for non-admins the per-tenant role comes from memberships
  isAdmin: boolean;
  memberships: TenantMembership[];
  activeTenantId: number | null; // null = admin "all tenants" mode, or an unprovisioned user
}

// A pending tenant invitation (token is never exposed in this view).
export interface Invite {
  id: number;
  email: string;
  tenant_id: number;
  tenant_name: string;
  role: MembershipRole;
  invited_by: string;
  created_at: string;
  expires_at: string;
}

// Admin user-management projection (used by the Admin page).
export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  is_admin: boolean;
  memberships: TenantMembership[];
}
export interface AuthProviders {
  google: boolean;
  microsoft: boolean;
  email: boolean;
  dev: boolean;
}

// Supported evidence-file kinds (validated + parsed on upload).
export type EvidenceKind = 'pdf' | 'word' | 'excel' | 'csv' | 'image' | 'unknown';
// Outcome of attempting to extract text/metadata from an evidence file.
//  extracted   -> text was pulled out
//  no_text     -> file recognised but carries no machine-readable text (e.g. image)
//  empty       -> parsed but produced no content
//  unsupported -> recognised container but this variant can't be parsed (e.g. legacy .doc)
//  error       -> parsing failed
export type EvidenceParseStatus = 'extracted' | 'no_text' | 'empty' | 'unsupported' | 'error';

export type DataCategory =
  | 'personal'
  | 'sensitive_personal'
  | 'phi'
  | 'children'
  | 'employee'
  | 'financial'
  | 'cross_border'
  | 'subprocessors';

export const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  personal: 'Personal data',
  sensitive_personal: 'Sensitive personal data',
  phi: 'PHI (health data)',
  children: "Children's data",
  employee: 'Employee data',
  financial: 'Financial data',
  cross_border: 'Cross-border transfers',
  subprocessors: 'Subprocessors',
};

// Envelope used by ALL API endpoints.
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Vendor {
  id: number;
  name: string;
  created_at: string;
}

export interface QuestionnaireItem {
  id: number;
  assessment_id: number;
  question_id: string;
  question_text: string;
  response: string;
  response_type: ResponseType;
  evidence_text: string | null;
  evidence_location: string | null;
  vendor_comments: string | null;
  relevant_date: string | null;
  expiration_date: string | null;
}

export type NewQuestionnaireItem = Omit<QuestionnaireItem, 'id' | 'assessment_id'>;

export interface FrameworkMapping {
  framework: string;
  references: string[];
}

export interface Finding {
  id: number;
  item_id: number;
  assessment_id: number;
  control_domain: string;
  framework_mappings: FrameworkMapping[];
  ai_finding: string;
  completeness: Completeness;
  control_strength: ControlStrength;
  evidence_sufficiency: EvidenceSufficiency;
  risk_level: RiskLevel;
  follow_up_questions: string[];
  ai_rationale: string;
  source: AiEngine;
  analyst_status: AnalystStatus;
  analyst_values: Partial<
    Pick<
      Finding,
      'control_domain' | 'framework_mappings' | 'risk_level' | 'evidence_sufficiency' | 'follow_up_questions'
    >
  > | null;
  updated_at: string;
}

export interface EvidenceFile {
  id: number;
  assessment_id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
  uploaded_at: string;
  // Parsing layer (added when the file is uploaded).
  kind: EvidenceKind;
  parse_status: EvidenceParseStatus;
  extracted_chars: number;
  extracted_text: string | null;
  parse_note: string | null;
}

export interface EvidenceContext {
  name: string;
  kind: EvidenceKind;
  text: string;
}

export interface Assessment {
  id: number;
  vendor_id: number;
  vendor_name: string;
  tenant_id: number | null;
  created_by: string | null;
  questionnaire_type: string;
  date_submitted: string;
  status: AssessmentStatus;
  data_categories: DataCategory[];
  applicable_frameworks: string[];
  overall_risk: RiskLevel | null;
  ai_engine_used: AiEngine | null;
  analyst_notes: string | null;
  business_context: string | null;
  validation_status: ValidationStatus;
  validated_by: string | null;
  validated_at: string | null;
  mapping_version: string | null;
  created_at: string;
  item_count?: number;
  finding_count?: number;
}

export interface AuditEntry {
  id: number;
  assessment_id: number;
  tenant_id: number | null;
  action: string;
  actor: string;
  role: Role;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ---- AI engine contract ----------------------------------------------------

// What an analysis provider (rule engine or Claude) returns for a single item.
export interface ItemAnalysis {
  control_domain: string;
  framework_mappings: FrameworkMapping[];
  completeness: Completeness;
  control_strength: ControlStrength;
  evidence_sufficiency: EvidenceSufficiency;
  risk_level: RiskLevel;
  ai_finding: string;
  ai_rationale: string;
  follow_up_questions: string[];
  data_categories: DataCategory[];
}

export interface AnalysisProvider {
  name: AiEngine;
  analyzeItem(item: QuestionnaireItem, evidence?: EvidenceContext[]): Promise<ItemAnalysis>;
}

export interface AnalyzeResult {
  engine: AiEngine;
  overall_risk: RiskLevel;
  data_categories: DataCategory[];
  applicable_frameworks: string[];
  findings: Finding[];
}

// ---- Composite API payloads ------------------------------------------------

export interface AssessmentDetail {
  assessment: Assessment;
  items: QuestionnaireItem[];
  findings: Finding[];
  evidence: EvidenceFile[];
}

export interface ReportData {
  vendor_name: string;
  questionnaire_type: string;
  date_submitted: string;
  data_categories: DataCategory[];
  applicable_frameworks: string[];
  controls: Array<{ item: QuestionnaireItem; finding: Finding }>;
  weak_or_missing: Finding[];
  evidence_gaps: Finding[];
  overall_risk: RiskLevel | null;
  follow_ups: string[];
  analyst_notes: string | null;
  business_context: string | null;
  validation_status: ValidationStatus;
  validated_by: string | null;
  validated_at: string | null;
  ai_engine_used: AiEngine | null;
  mapping_version: string | null;
  generated_at: string;
}

export interface ScenarioSummary {
  key: string;
  vendor_name: string;
  sector: string;
  expected_risk: RiskLevel;
  data_categories: DataCategory[];
  summary: string;
}

// Effective (analyst-overridden) view of a finding's fields.
export function effectiveFinding(f: Finding): {
  control_domain: string;
  framework_mappings: FrameworkMapping[];
  risk_level: RiskLevel;
  evidence_sufficiency: EvidenceSufficiency;
  follow_up_questions: string[];
} {
  const ov = f.analyst_values ?? {};
  return {
    control_domain: ov.control_domain ?? f.control_domain,
    framework_mappings: ov.framework_mappings ?? f.framework_mappings,
    risk_level: ov.risk_level ?? f.risk_level,
    evidence_sufficiency: ov.evidence_sufficiency ?? f.evidence_sufficiency,
    follow_up_questions: ov.follow_up_questions ?? f.follow_up_questions,
  };
}

// ---- Experimentation platform (A/B testing, spec 0015) ---------------------
// Definitions are config-as-code in experiments/*.yml (validated by
// scripts/experiments.mjs) and compiled to server/src/data/experiments.json.

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

export interface ExperimentVariant {
  key: string;
  weight: number; // 0..100; the variants' weights sum to 100 (CI-enforced)
}

export interface ExperimentTargeting {
  roles?: Role[]; // omitted/empty = all roles
  tenants?: number[]; // omitted/empty = all tenants
}

export interface Experiment {
  key: string;
  name: string;
  hypothesis?: string;
  owner?: string;
  surface?: string;
  status: ExperimentStatus;
  created?: string;
  start?: string;
  end?: string;
  variants: ExperimentVariant[]; // variants[0] is the control / default
  targeting?: ExperimentTargeting;
  metrics?: { primary: string; secondary?: string[] };
  tracking_issue?: number;
}

// GET /api/flags response: experiment key -> assigned variant, for running+eligible
// experiments only. Absent key => the caller treats it as control.
export type FlagAssignments = Record<string, string>;

export interface VariantResult {
  key: string;
  exposed: number;
  converted: number;
  rate: number; // converted / exposed (0 when exposed is 0)
}

// Two-proportion z-test of one variant against the control, for the primary metric.
export interface VariantComparison {
  variant: string;
  control: string;
  z: number | null;
  pValue: number | null; // two-sided; null when either arm has no exposures
  ciLow: number | null; // 95% CI for (rate_variant - rate_control)
  ciHigh: number | null;
}

export interface ExperimentResults {
  key: string;
  name: string;
  status: ExperimentStatus;
  metric: string | null; // primary metric conversions are counted on
  variants: VariantResult[];
  comparisons: VariantComparison[];
}
