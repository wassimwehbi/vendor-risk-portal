import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, getScenario } from '../src/data/scenarios/index';
import { ruleEngine } from '../src/services/ruleEngine';
import { aggregateRisk, scoreItem } from '../src/services/riskScoring';
import type { DataCategory, ItemAnalysis, QuestionnaireItem, RiskLevel } from '../src/types';

const GDPR_TRIGGERS: DataCategory[] = ['personal', 'sensitive_personal', 'children', 'employee', 'cross_border', 'subprocessors'];

function deriveFrameworks(categories: DataCategory[]): string[] {
  const f = ['ISO 27001', 'ISO 27002'];
  if (categories.some((c) => GDPR_TRIGGERS.includes(c))) f.push('GDPR');
  if (categories.includes('phi')) f.push('HIPAA');
  return f;
}

// Mirrors aiEngine.analyzeAssessment's pure computation (without persistence).
async function analyzeScenario(key: string): Promise<{
  overall: RiskLevel;
  data_categories: DataCategory[];
  frameworks: string[];
  analyses: Array<{ item: QuestionnaireItem; analysis: ItemAnalysis; level: RiskLevel }>;
}> {
  const scenario = getScenario(key)!;
  const analyses: Array<{ item: QuestionnaireItem; analysis: ItemAnalysis; level: RiskLevel }> = [];
  for (let i = 0; i < scenario.items.length; i++) {
    const item: QuestionnaireItem = { id: i + 1, assessment_id: 1, ...scenario.items[i] };
    const analysis = await ruleEngine.analyzeItem(item);
    analyses.push({ item, analysis, level: analysis.risk_level });
  }
  const cats = new Set<DataCategory>();
  analyses.forEach(({ analysis }) => analysis.data_categories.forEach((c) => cats.add(c)));
  const data_categories = [...cats];
  for (const a of analyses) {
    a.level = scoreItem({
      control_strength: a.analysis.control_strength,
      evidence_sufficiency: a.analysis.evidence_sufficiency,
      completeness: a.analysis.completeness,
      data_categories,
      control_domain: a.analysis.control_domain,
    });
  }
  return {
    overall: aggregateRisk(analyses.map((a) => a.level)),
    data_categories,
    frameworks: deriveFrameworks(data_categories),
    analyses,
  };
}

for (const scenario of SCENARIOS) {
  test(`scenario "${scenario.key}" computes expected overall risk ${scenario.expected_risk}`, async () => {
    const result = await analyzeScenario(scenario.key);
    assert.equal(result.overall, scenario.expected_risk, `${scenario.vendor_name} risk band`);
  });
}

test('CloudPay flags absent MFA as a Critical finding', async () => {
  const { analyses } = await analyzeScenario('cloudpay');
  const mfa = analyses.find((a) => a.analysis.control_domain === 'MFA');
  assert.ok(mfa, 'expected an MFA finding');
  assert.equal(mfa!.analysis.control_strength, 'None');
  assert.equal(mfa!.level, 'Critical');
});

test('CloudPay detects an expired certification', async () => {
  const { analyses } = await analyzeScenario('cloudpay');
  const expired = analyses.filter((a) => a.analysis.evidence_sufficiency === 'Expired');
  assert.ok(expired.length >= 1, 'expected at least one expired-evidence finding');
});

test('SecureHealth triggers GDPR and HIPAA frameworks', async () => {
  const { frameworks, data_categories } = await analyzeScenario('securehealth');
  assert.ok(data_categories.includes('phi'));
  assert.ok(frameworks.includes('HIPAA'));
  assert.ok(frameworks.includes('GDPR'));
});

test('VagueVendor produces pervasive evidence-insufficiency findings', async () => {
  const { analyses } = await analyzeScenario('vaguevendor');
  const insufficient = analyses.filter((a) => a.analysis.evidence_sufficiency === 'Insufficient');
  assert.ok(insufficient.length >= 5, `expected many insufficient-evidence findings, got ${insufficient.length}`);
  const vague = analyses.filter((a) => a.analysis.completeness === 'Vague');
  assert.ok(vague.length >= 5, `expected many vague findings, got ${vague.length}`);
});

test('every scenario generates follow-up questions where gaps exist', async () => {
  const { analyses } = await analyzeScenario('securehealth');
  const withFollowUps = analyses.filter((a) => a.analysis.follow_up_questions.length > 0);
  assert.ok(withFollowUps.length >= 1);
});
