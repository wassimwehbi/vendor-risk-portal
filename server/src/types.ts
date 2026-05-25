// Shared client/server contract for the Vendor Risk Questionnaire Analysis Tool.
// The client keeps a copy of these types in client/src/types.ts.

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ResponseType = 'Yes' | 'No' | 'Partial' | 'N/A' | 'FreeText';
export type ControlStrength = 'Strong' | 'Medium' | 'Weak' | 'None';
export type EvidenceSufficiency =
  | 'Sufficient'
  | 'Insufficient'
  | 'None'
  | 'Expired'
  | 'Misaligned';
export type Completeness = 'Complete' | 'Partial' | 'Vague' | 'Missing';
export type AnalystStatus = 'pending' | 'accepted' | 'overridden';
export type AssessmentStatus = 'uploaded' | 'extracted' | 'analyzed' | 'approved';
export type ValidationStatus = 'pending' | 'approved';
export type AiEngine = 'claude' | 'rule';
export type Role = 'Analyst' | 'Admin' | 'Viewer';

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
      | 'control_domain'
      | 'framework_mappings'
      | 'risk_level'
      | 'evidence_sufficiency'
      | 'follow_up_questions'
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
}

export interface Assessment {
  id: number;
  vendor_id: number;
  vendor_name: string;
  questionnaire_type: string;
  date_submitted: string;
  status: AssessmentStatus;
  data_categories: DataCategory[];
  applicable_frameworks: string[];
  overall_risk: RiskLevel | null;
  ai_engine_used: AiEngine | null;
  analyst_notes: string | null;
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
  analyzeItem(item: QuestionnaireItem): Promise<ItemAnalysis>;
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
