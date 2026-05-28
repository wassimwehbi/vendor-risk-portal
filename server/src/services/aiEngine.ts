import { db, mapFinding, mapItem, nowIso } from '../db';
import type {
  AiEngine,
  AnalysisProvider,
  AnalyzeResult,
  DataCategory,
  EvidenceContext,
  EvidenceKind,
  Finding,
  ItemAnalysis,
  PersonalDataVolume,
  QuestionnaireItem,
} from '../types';
import type { AccessScope } from '../routes/_helpers';
import { ruleEngine } from './ruleEngine';
import { createClaudeProvider } from './claudeProvider';
import { aggregateRisk, scoreItem } from './riskScoring';
import { getMappingVersion } from './frameworkMapping';
import { logAudit } from './audit';

const INTERNET_FACING_PATTERNS = [
  /internet[- ]facing/i,
  /publicly accessible/i,
  /public[- ]facing/i,
  /external[- ]users/i,
  /public api/i,
  /web application/i,
  /exposed to the internet/i,
  /accessible from the internet/i,
];

const HIGH_VOLUME_PATTERNS = [
  /million[s]? (of )?(record|user|customer|individual)/i,
  /billion[s]? (of )?(record|user|customer|individual)/i,
  /large (volume|scale|dataset)/i,
  /high volume/i,
];

const MEDIUM_VOLUME_PATTERNS = [
  /thousand[s]? (of )?(record|user|customer|individual)/i,
  /hundred[s]? of thousand/i,
  /moderate volume/i,
];

function detectExposureSignals(items: QuestionnaireItem[]): {
  internet_facing: boolean;
  personal_data_volume: PersonalDataVolume | null;
} {
  const combined = items.map((i) => `${i.question_text} ${i.response} ${i.vendor_comments ?? ''}`).join('\n');

  const internet_facing = INTERNET_FACING_PATTERNS.some((p) => p.test(combined));

  let personal_data_volume: PersonalDataVolume | null = null;
  if (HIGH_VOLUME_PATTERNS.some((p) => p.test(combined))) {
    personal_data_volume = 'high';
  } else if (MEDIUM_VOLUME_PATTERNS.some((p) => p.test(combined))) {
    personal_data_volume = 'medium';
  }

  return { internet_facing, personal_data_volume };
}

const GDPR_TRIGGERS: DataCategory[] = [
  'personal',
  'sensitive_personal',
  'children',
  'employee',
  'cross_border',
  'subprocessors',
];

function deriveFrameworks(analyses: Array<{ analysis: ItemAnalysis }>, categories: DataCategory[]): string[] {
  const set = new Set<string>();
  for (const { analysis } of analyses) {
    for (const { framework } of analysis.framework_mappings) {
      set.add(framework);
    }
  }
  if (categories.some((c) => GDPR_TRIGGERS.includes(c))) set.add('GDPR');
  if (categories.includes('phi')) set.add('HIPAA');
  return [...set];
}

/**
 * Runs AI-assisted analysis over every questionnaire item in an assessment.
 * Uses the Claude provider when ANTHROPIC_API_KEY is configured, otherwise the
 * deterministic rule engine. Per-item errors transparently fall back to the
 * rule engine. Risk levels are (re)computed deterministically using the
 * assessment-wide data sensitivity, so the result is explainable and auditable.
 *
 * Re-running analysis resets any prior human validation back to "pending":
 * a previous approval no longer reflects the freshly computed findings.
 */
export async function analyzeAssessment(assessmentId: number, scope: AccessScope): Promise<AnalyzeResult> {
  // An admin in all-tenants mode can analyze any assessment; the tenant is
  // derived from the assessment itself. Tenant-scoped users (and non-admins)
  // keep a tenant-filtered fetch, so cross-tenant analyze is still "not found".
  const adminAllTenants = scope.isAdmin && scope.activeTenantId == null;
  const assessmentRow = adminAllTenants
    ? (db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) as any)
    : (db
        .prepare('SELECT * FROM assessments WHERE id = ? AND tenant_id = ?')
        .get(assessmentId, scope.activeTenantId) as any);
  if (!assessmentRow) throw new Error(`Assessment ${assessmentId} not found`);
  const tenantId = assessmentRow.tenant_id as number;

  const itemRows = db
    .prepare('SELECT * FROM questionnaire_items WHERE assessment_id = ? ORDER BY id')
    .all(assessmentId);
  const items: QuestionnaireItem[] = itemRows.map(mapItem);
  if (items.length === 0) throw new Error('No questionnaire items to analyze. Upload a questionnaire first.');

  const evidenceRows = db
    .prepare(
      `SELECT original_name, kind, extracted_text FROM evidence_files
       WHERE assessment_id = ? AND parse_status = 'extracted' AND extracted_text IS NOT NULL`,
    )
    .all(assessmentId) as Array<{ original_name: string; kind: string; extracted_text: string }>;
  const evidenceContext: EvidenceContext[] = evidenceRows.map((r) => ({
    name: r.original_name,
    kind: r.kind as EvidenceKind,
    text: r.extracted_text,
  }));

  const wasApproved = assessmentRow.validation_status === 'approved';

  const claude = createClaudeProvider();
  const primary: AnalysisProvider = claude ?? ruleEngine;

  // 1) Analyze each item with the primary provider, falling back per-item.
  const analyses: Array<{ item: QuestionnaireItem; analysis: ItemAnalysis; source: AiEngine }> = [];
  for (const item of items) {
    try {
      const analysis = await primary.analyzeItem(item, evidenceContext);
      analyses.push({ item, analysis, source: primary.name });
    } catch (err) {
      console.warn(`[aiEngine] ${primary.name} failed for item ${item.id}, falling back to rule engine:`, err);
      const analysis = await ruleEngine.analyzeItem(item, evidenceContext);
      analyses.push({ item, analysis, source: 'rule' });
    }
  }

  // 2) Aggregate data categories across the whole assessment.
  const allCategories = new Set<DataCategory>();
  for (const { analysis } of analyses) analysis.data_categories.forEach((c) => allCategories.add(c));
  const data_categories = [...allCategories];
  const applicable_frameworks = deriveFrameworks(analyses, data_categories);

  // 2b) Detect exposure signals from questionnaire text.
  // Prefer any analyst-declared value already on the assessment over auto-detected.
  const detected = detectExposureSignals(items);
  const internet_facing: boolean =
    assessmentRow.internet_facing != null ? Boolean(assessmentRow.internet_facing) : detected.internet_facing;
  const personal_data_volume: PersonalDataVolume | null =
    assessmentRow.personal_data_volume ?? detected.personal_data_volume;

  // 3) Recompute risk per item using the assessment-wide sensitivity context.
  for (const a of analyses) {
    a.analysis.risk_level = scoreItem({
      control_strength: a.analysis.control_strength,
      evidence_sufficiency: a.analysis.evidence_sufficiency,
      completeness: a.analysis.completeness,
      data_categories,
      control_domain: a.analysis.control_domain,
      internet_facing,
      personal_data_volume,
    });
  }

  const overall_risk = aggregateRisk(analyses.map((a) => a.analysis.risk_level));
  const engineUsed: AiEngine = analyses.some((a) => a.source === 'claude') ? 'claude' : 'rule';
  const mappingVersion = getMappingVersion();
  const now = nowIso();

  // 4) Persist: replace findings, update assessment. Wrapped in a transaction.
  const persist = db.transaction(() => {
    db.prepare('DELETE FROM findings WHERE assessment_id = ?').run(assessmentId);
    const insert = db.prepare(`
      INSERT INTO findings (
        item_id, assessment_id, control_domain, framework_mappings, ai_finding,
        completeness, control_strength, evidence_sufficiency, risk_level,
        follow_up_questions, ai_rationale, source, analyst_status, analyst_values, updated_at
      ) VALUES (
        @item_id, @assessment_id, @control_domain, @framework_mappings, @ai_finding,
        @completeness, @control_strength, @evidence_sufficiency, @risk_level,
        @follow_up_questions, @ai_rationale, @source, 'pending', NULL, @updated_at
      )
    `);
    for (const { item, analysis, source } of analyses) {
      insert.run({
        item_id: item.id,
        assessment_id: assessmentId,
        control_domain: analysis.control_domain,
        framework_mappings: JSON.stringify(analysis.framework_mappings),
        ai_finding: analysis.ai_finding,
        completeness: analysis.completeness,
        control_strength: analysis.control_strength,
        evidence_sufficiency: analysis.evidence_sufficiency,
        risk_level: analysis.risk_level,
        follow_up_questions: JSON.stringify(analysis.follow_up_questions),
        ai_rationale: analysis.ai_rationale,
        source,
        updated_at: now,
      });
    }
    // Re-analysis invalidates any prior human approval.
    db.prepare(`
      UPDATE assessments
      SET status = 'analyzed',
          data_categories = @data_categories,
          applicable_frameworks = @applicable_frameworks,
          overall_risk = @overall_risk,
          ai_engine_used = @ai_engine_used,
          mapping_version = @mapping_version,
          internet_facing = @internet_facing,
          personal_data_volume = @personal_data_volume,
          validation_status = 'pending',
          validated_by = NULL,
          validated_at = NULL
      WHERE id = @id
    `).run({
      id: assessmentId,
      data_categories: JSON.stringify(data_categories),
      applicable_frameworks: JSON.stringify(applicable_frameworks),
      overall_risk,
      ai_engine_used: engineUsed,
      mapping_version: mappingVersion,
      internet_facing: internet_facing ? 1 : 0,
      personal_data_volume: personal_data_volume ?? null,
    });
  });
  persist();

  logAudit({
    assessment_id: assessmentId,
    tenant_id: tenantId,
    action: 'ai_analysis',
    actor: scope.actor,
    role: scope.effectiveRole,
    details: {
      engine: engineUsed,
      overall_risk,
      item_count: items.length,
      mapping_version: mappingVersion,
      reset_prior_approval: wasApproved,
    },
  });

  const findingRows = db.prepare('SELECT * FROM findings WHERE assessment_id = ? ORDER BY id').all(assessmentId);
  const findings: Finding[] = findingRows.map(mapFinding);

  return { engine: engineUsed, overall_risk, data_categories, applicable_frameworks, findings };
}
