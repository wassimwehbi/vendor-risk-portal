import { db, mapFinding, mapItem, nowIso } from '../db';
import type {
  AiEngine,
  AnalysisProvider,
  AnalyzeResult,
  DataCategory,
  Finding,
  ItemAnalysis,
  QuestionnaireItem,
} from '../types';
import type { AccessScope } from '../routes/_helpers';
import { ruleEngine } from './ruleEngine';
import { createClaudeProvider } from './claudeProvider';
import { aggregateRisk, scoreItem } from './riskScoring';
import { getMappingVersion } from './frameworkMapping';
import { logAudit } from './audit';

const GDPR_TRIGGERS: DataCategory[] = ['personal', 'sensitive_personal', 'children', 'employee', 'cross_border', 'subprocessors'];

function deriveFrameworks(categories: DataCategory[]): string[] {
  const frameworks = ['ISO 27001', 'ISO 27002'];
  if (categories.some((c) => GDPR_TRIGGERS.includes(c))) frameworks.push('GDPR');
  if (categories.includes('phi')) frameworks.push('HIPAA');
  return frameworks;
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
export async function analyzeAssessment(
  assessmentId: number,
  scope: AccessScope,
): Promise<AnalyzeResult> {
  // An admin in all-tenants mode can analyze any assessment; the tenant is
  // derived from the assessment itself. Tenant-scoped users (and non-admins)
  // keep a tenant-filtered fetch, so cross-tenant analyze is still "not found".
  const adminAllTenants = scope.isAdmin && scope.activeTenantId == null;
  const assessmentRow = adminAllTenants
    ? (db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) as any)
    : (db.prepare('SELECT * FROM assessments WHERE id = ? AND tenant_id = ?').get(assessmentId, scope.activeTenantId) as any);
  if (!assessmentRow) throw new Error(`Assessment ${assessmentId} not found`);
  const tenantId = assessmentRow.tenant_id as number;

  const itemRows = db.prepare('SELECT * FROM questionnaire_items WHERE assessment_id = ? ORDER BY id').all(assessmentId);
  const items: QuestionnaireItem[] = itemRows.map(mapItem);
  if (items.length === 0) throw new Error('No questionnaire items to analyze. Upload a questionnaire first.');

  const wasApproved = assessmentRow.validation_status === 'approved';

  const claude = createClaudeProvider();
  const primary: AnalysisProvider = claude ?? ruleEngine;

  // 1) Analyze each item with the primary provider, falling back per-item.
  const analyses: Array<{ item: QuestionnaireItem; analysis: ItemAnalysis; source: AiEngine }> = [];
  for (const item of items) {
    try {
      const analysis = await primary.analyzeItem(item);
      analyses.push({ item, analysis, source: primary.name });
    } catch (err) {
      console.warn(`[aiEngine] ${primary.name} failed for item ${item.id}, falling back to rule engine:`, err);
      const analysis = await ruleEngine.analyzeItem(item);
      analyses.push({ item, analysis, source: 'rule' });
    }
  }

  // 2) Aggregate data categories across the whole assessment.
  const allCategories = new Set<DataCategory>();
  for (const { analysis } of analyses) analysis.data_categories.forEach((c) => allCategories.add(c));
  const data_categories = [...allCategories];
  const applicable_frameworks = deriveFrameworks(data_categories);

  // 3) Recompute risk per item using the assessment-wide sensitivity context.
  for (const a of analyses) {
    a.analysis.risk_level = scoreItem({
      control_strength: a.analysis.control_strength,
      evidence_sufficiency: a.analysis.evidence_sufficiency,
      completeness: a.analysis.completeness,
      data_categories,
      control_domain: a.analysis.control_domain,
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
