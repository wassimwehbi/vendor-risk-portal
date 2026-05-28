import type { Assessment, ScenarioSummary } from '../types';
import { SCENARIOS, getScenario } from '../data/scenarios/index';
import type { AccessScope } from '../routes/_helpers';
import { addEvidenceFiles, createAssessment, replaceItems } from './store';
import type { NewEvidence } from './store';
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
 * questionnaire items, in the caller's active tenant. Each call creates a new
 * assessment so demos are repeatable. The caller may then run analysis.
 */
export function loadScenario(key: string, scope: AccessScope): Assessment | undefined {
  const scenario = getScenario(key);
  if (!scenario) return undefined;

  const assessment = createAssessment(
    {
      vendor_name: scenario.vendor_name,
      questionnaire_type: scenario.questionnaire_type,
      date_submitted: new Date().toISOString().slice(0, 10),
      internet_facing: scenario.internet_facing,
      personal_data_volume: scenario.personal_data_volume,
    },
    scope,
  );
  replaceItems(assessment.id, scenario.items, scope);

  // Seed demo evidence for the TrustVault scenario so the Evidence panel and
  // AI-described image provenance chip (feature #45) are exercised in UX tests.
  if (scenario.key === 'trustvault') {
    const demoEvidence: NewEvidence[] = [
      {
        original_name: 'iso27001-certificate.png',
        stored_name: 'demo-iso27001-certificate.png',
        mime_type: 'image/png',
        size: 47_312,
        kind: 'image',
        parse_status: 'extracted',
        extracted_chars: 318,
        extracted_text:
          'ISO/IEC 27001:2022 Certificate of Registration\nCertified Organization: TrustVault Security Ltd\nCertification Body: BSI Group\nCertificate Number: IS 123456\nFirst Issued: 2022-04-01\nExpiry Date: 2027-03-31\nScope: Design, development, and operation of cloud security tooling.',
        parse_note: 'Vision description',
      },
      {
        original_name: 'pentest-report-2026-02.pdf',
        stored_name: 'demo-pentest-report-2026-02.pdf',
        mime_type: 'application/pdf',
        size: 214_080,
        kind: 'pdf',
        parse_status: 'extracted',
        extracted_chars: 4_210,
        extracted_text:
          'Executive Summary\nThis report presents the results of an external penetration test conducted in February 2026. No critical findings were identified. Two medium findings related to HTTP security headers were remediated during the test window.',
        parse_note: null,
      },
    ];
    addEvidenceFiles(assessment.id, demoEvidence, scope);
  }

  logAudit({
    assessment_id: assessment.id,
    tenant_id: scope.activeTenantId,
    action: 'demo_scenario_loaded',
    actor: scope.actor,
    role: scope.effectiveRole,
    details: { scenario: key },
  });
  // Return the refreshed assessment (status now 'extracted').
  return { ...assessment, status: 'extracted', item_count: scenario.items.length };
}
