import type { Assessment, ScenarioSummary, Role } from '../types';
import { SCENARIOS, getScenario } from '../data/scenarios/index';
import { createAssessment, replaceItems } from './store';
import { logAudit } from './audit';

export function listScenarios(): ScenarioSummary[] {
  return SCENARIOS.map((s) => ({
    key: s.key,
    vendor_name: s.vendor_name,
    sector: s.sector,
    expected_risk: s.expected_risk,
    data_categories: s.data_categories,
    summary: s.summary,
  }));
}

/**
 * Creates a fresh assessment pre-populated with a demo scenario's vendor and
 * questionnaire items. Each call creates a new assessment so demos are repeatable.
 * The caller may then run analysis on the returned assessment.
 */
export function loadScenario(key: string, actor: string, role: Role): Assessment | undefined {
  const scenario = getScenario(key);
  if (!scenario) return undefined;

  const assessment = createAssessment(
    {
      vendor_name: scenario.vendor_name,
      questionnaire_type: scenario.questionnaire_type,
      date_submitted: new Date().toISOString().slice(0, 10),
    },
    actor,
    role,
  );
  replaceItems(assessment.id, scenario.items, actor, role);
  logAudit({
    assessment_id: assessment.id,
    action: 'demo_scenario_loaded',
    actor,
    role,
    details: { scenario: key },
  });
  // Return the refreshed assessment (status now 'extracted').
  return { ...assessment, status: 'extracted', item_count: scenario.items.length };
}
