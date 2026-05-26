import type { DataCategory, NewQuestionnaireItem, ResponseType, RiskLevel } from '../../types';

export interface Scenario {
  key: string;
  vendor_name: string;
  sector: string;
  questionnaire_type: string;
  expected_risk: RiskLevel;
  summary: string;
  data_categories: DataCategory[];
  items: NewQuestionnaireItem[];
}

interface ItemOpts {
  evidence_text?: string;
  evidence_location?: string;
  vendor_comments?: string;
  relevant_date?: string;
  expiration_date?: string;
}

function mk(
  question_id: string,
  question_text: string,
  response: string,
  response_type: ResponseType,
  opts: ItemOpts = {},
): NewQuestionnaireItem {
  return {
    question_id,
    question_text,
    response,
    response_type,
    evidence_text: opts.evidence_text ?? null,
    evidence_location: opts.evidence_location ?? null,
    vendor_comments: opts.vendor_comments ?? null,
    relevant_date: opts.relevant_date ?? null,
    expiration_date: opts.expiration_date ?? null,
  };
}

// ---------------------------------------------------------------------------
// 1) TrustVault Security — strong posture, valid evidence -> expected LOW
// ---------------------------------------------------------------------------
const trustVault: Scenario = {
  key: 'trustvault',
  vendor_name: 'TrustVault Security',
  sector: 'Security tooling (SaaS)',
  questionnaire_type: 'SIG Lite',
  expected_risk: 'Low',
  summary: 'Mature security vendor with strong, well-evidenced controls and valid certifications.',
  data_categories: ['personal', 'subprocessors'],
  items: [
    mk(
      'Q1',
      'Do you enforce MFA for all users?',
      'Yes. MFA is enforced for all users and administrators using TOTP authenticator apps and hardware security keys.',
      'Yes',
      { evidence_text: 'IdP configuration screenshot', evidence_location: 'MFA enforcement policy, p.2' },
    ),
    mk('Q2', 'Is data encrypted at rest?', 'Yes. All data at rest is encrypted using AES-256.', 'Yes', {
      evidence_text: 'KMS configuration screenshot',
      evidence_location: 'Encryption standard doc',
    }),
    mk('Q3', 'Is data encrypted in transit?', 'Yes. All data in transit is protected with TLS 1.3.', 'Yes', {
      evidence_text: 'SSL Labs A+ report',
      evidence_location: 'Network security configuration',
    }),
    mk(
      'Q4',
      'Do you have an incident response plan?',
      'Yes. We maintain a documented IR plan that is tested annually; the last tabletop exercise was completed in January 2026.',
      'Yes',
      { evidence_text: '2026 incident response tabletop test results report', evidence_location: 'IR plan v4' },
    ),
    mk(
      'Q5',
      'Do you test disaster recovery?',
      'Yes. BCP and DR plans are tested annually with RTO 4h and RPO 1h; the last DR test ran in December 2025.',
      'Yes',
      { evidence_text: 'DR test report 2025-12', evidence_location: 'BCP/DR plan' },
    ),
    mk(
      'Q6',
      'Describe your vulnerability management program.',
      'We run continuous vulnerability scanning and quarterly external penetration tests with remediation SLAs by severity.',
      'FreeText',
      {
        evidence_text: 'Latest penetration test report 2026-02',
        evidence_location: 'Vulnerability management standard',
      },
    ),
    mk(
      'Q7',
      'How are backups managed?',
      'Encrypted backups run every 4 hours and restores are tested monthly.',
      'Yes',
      { evidence_text: 'Backup configuration screenshot and restore test log', evidence_location: 'Backup policy' },
    ),
    mk(
      'Q8',
      'How do you manage subprocessors?',
      'We maintain a current subprocessor register and flow down security and DPA obligations; subprocessors are vetted annually.',
      'Yes',
      { evidence_text: 'Subprocessor register and DPA template', evidence_location: 'TPRM standard' },
    ),
    mk(
      'Q9',
      'What is your data retention and deletion practice?',
      'Data is retained per contract and securely deleted per NIST 800-88 within 30 days of termination.',
      'Yes',
      { evidence_text: 'Deletion certificate sample', evidence_location: 'Data retention and deletion standard' },
    ),
    mk(
      'Q10',
      'Are you certified to ISO 27001?',
      'Yes. We are ISO 27001 certified and maintain a privacy program with a designated DPO.',
      'Yes',
      {
        evidence_text: 'ISO 27001 certificate',
        evidence_location: 'Certificate registry',
        expiration_date: '2027-03-31',
      },
    ),
    mk(
      'Q11',
      'What personal data do you process?',
      'We process customer personal data such as names and email addresses for EU and US customers.',
      'FreeText',
      { evidence_text: 'Records of Processing Activities (RoPA) register', evidence_location: 'RoPA' },
    ),
  ],
};

// ---------------------------------------------------------------------------
// 2) DataFlow Analytics — solid but some evidence/detail gaps -> expected MEDIUM (GDPR)
// ---------------------------------------------------------------------------
const dataFlow: Scenario = {
  key: 'dataflow',
  vendor_name: 'DataFlow Analytics',
  sector: 'Analytics (SaaS, EU personal data)',
  questionnaire_type: 'SIG Core',
  expected_risk: 'Medium',
  summary: 'Processes EU personal data with mostly solid controls but evidence and detail gaps in a few areas.',
  data_categories: ['personal'],
  items: [
    mk('Q1', 'Do you enforce MFA for all users?', 'Yes. MFA is enforced for all users via authenticator app.', 'Yes', {
      evidence_text: 'IdP MFA configuration screenshot',
      evidence_location: 'Access policy',
    }),
    mk('Q2', 'Is data encrypted at rest and in transit?', 'Yes. AES-256 at rest and TLS 1.2 in transit.', 'Yes', {
      evidence_text: 'Encryption configuration report',
      evidence_location: 'Crypto standard',
    }),
    mk(
      'Q3',
      'Describe your logging and monitoring.',
      'Centralized logging via a SIEM with 1-year retention.',
      'FreeText',
      { evidence_text: 'SIEM dashboard screenshot', evidence_location: 'Logging standard' },
    ),
    mk(
      'Q4',
      'Do you have an incident response process?',
      'Yes, we have an incident response policy and notify customers of breaches.',
      'Yes',
      { evidence_text: 'Incident response policy', evidence_location: 'IR policy' },
    ),
    mk(
      'Q5',
      'What is your data retention practice?',
      'Personal data is retained for the contract term; the deletion process is being formalized.',
      'FreeText',
      {},
    ),
    mk(
      'Q6',
      'Do you conduct penetration testing?',
      'Yes, an annual penetration test is conducted by a third party.',
      'Yes',
      { evidence_text: 'Penetration test report 2025-11', evidence_location: 'Security testing records' },
    ),
    mk(
      'Q7',
      'How do you manage subprocessors?',
      'We maintain a subprocessor list and require DPAs with all subprocessors.',
      'Yes',
      { evidence_text: 'Subprocessor register', evidence_location: 'TPRM register' },
    ),
    mk(
      'Q8',
      'Do you test disaster recovery?',
      'Yes. The DR plan is tested annually; the last test was in October 2025.',
      'Yes',
      { evidence_text: 'DR test summary 2025-10', evidence_location: 'BCP/DR plan' },
    ),
    mk(
      'Q9',
      'What personal data do you process and for whom?',
      'We process personal data (names, emails, usage analytics) for EU-based customers.',
      'FreeText',
      { evidence_text: 'Records of Processing Activities register', evidence_location: 'RoPA' },
    ),
  ],
};

// ---------------------------------------------------------------------------
// 3) SecureHealth Systems — PHI with partial controls -> expected HIGH (HIPAA)
// ---------------------------------------------------------------------------
const secureHealth: Scenario = {
  key: 'securehealth',
  vendor_name: 'SecureHealth Systems',
  sector: 'Healthcare technology (processes PHI)',
  questionnaire_type: 'SIG Core',
  expected_risk: 'High',
  summary: 'Processes PHI but several key controls are only partial and lack supporting evidence.',
  data_categories: ['phi', 'sensitive_personal', 'personal'],
  items: [
    mk('Q1', 'Do you enforce MFA?', 'MFA is enforced for administrators only.', 'Partial', {}),
    mk('Q2', 'How is data encrypted?', 'We encrypt sensitive data.', 'Yes', {}),
    mk('Q3', 'Do you have access controls?', 'Yes. Role-based access control with annual access reviews.', 'Yes', {
      evidence_text: 'Access review report',
      evidence_location: 'Access control policy',
    }),
    mk('Q4', 'Is data encrypted in transit?', 'Yes. TLS 1.2 is enforced for all external connections.', 'Yes', {
      evidence_text: 'TLS configuration report',
      evidence_location: 'Network security',
    }),
    mk(
      'Q5',
      'Do you have an incident response plan?',
      'Yes. The incident response plan is tested annually and includes breach notification timelines.',
      'Yes',
      { evidence_text: 'IR tabletop report 2025-09', evidence_location: 'IR plan' },
    ),
    mk(
      'Q6',
      'Do you maintain business continuity and DR?',
      'We have a business continuity plan; DR testing is performed periodically.',
      'Yes',
      {},
    ),
    mk('Q7', 'Do you use subprocessors?', 'We may use subprocessors to deliver the service.', 'FreeText', {}),
    mk('Q8', 'Describe your logging and monitoring.', 'We use a SIEM with one year of log retention.', 'Yes', {
      evidence_text: 'SIEM screenshot',
      evidence_location: 'Logging standard',
    }),
    mk(
      'Q9',
      'What health data do you process?',
      'We process protected health information (PHI) on behalf of covered entities.',
      'FreeText',
      { evidence_text: 'Data flow diagram', evidence_location: 'Architecture doc' },
    ),
    mk('Q10', 'Is a BAA in place?', 'Yes, a Business Associate Agreement is available.', 'Yes', {
      evidence_text: 'BAA template',
      evidence_location: 'Contracts',
    }),
  ],
};

// ---------------------------------------------------------------------------
// 4) CloudPay Inc. — financial + PHI, missing core controls -> expected CRITICAL
// ---------------------------------------------------------------------------
const cloudPay: Scenario = {
  key: 'cloudpay',
  vendor_name: 'CloudPay Inc.',
  sector: 'Payments platform (financial + health data, internet-facing)',
  questionnaire_type: 'SIG Core',
  expected_risk: 'Critical',
  summary:
    'Internet-facing payments platform processing financial and health data with major control gaps and expired evidence.',
  data_categories: ['financial', 'phi', 'cross_border', 'personal'],
  items: [
    mk('Q1', 'Do you enforce MFA for privileged users?', 'No.', 'No', {}),
    mk('Q2', 'How is data encrypted?', 'We encrypt data in transit but not at rest.', 'FreeText', {}),
    mk(
      'Q3',
      'Do you have an incident response process?',
      'We do not have a formal incident response process.',
      'FreeText',
      {},
    ),
    mk('Q4', 'Provide your most recent SOC 2 report.', 'Yes, we have a SOC 2 Type II report.', 'Yes', {
      evidence_text: 'SOC 2 Type II report',
      evidence_location: 'Audit reports',
      expiration_date: '2024-06-30',
    }),
    mk(
      'Q5',
      'Do you transfer data internationally?',
      'We transfer data to servers outside the EU without standard contractual clauses.',
      'FreeText',
      {},
    ),
    mk(
      'Q6',
      'What data do you process?',
      'We process payment card data and health information for global customers.',
      'FreeText',
      {},
    ),
    mk(
      'Q7',
      'Do you perform vulnerability scanning?',
      'Scanning is performed occasionally when time permits.',
      'Partial',
      { vendor_comments: 'No formal cadence.' },
    ),
    mk(
      'Q8',
      'Do you maintain backups?',
      'Backups are taken but have never been tested for restoration.',
      'FreeText',
      {},
    ),
    mk(
      'Q9',
      'Do you have a business continuity plan?',
      'No formal business continuity or disaster recovery plan exists.',
      'FreeText',
      {},
    ),
    mk(
      'Q10',
      'How do you manage subprocessors?',
      'We use various third-party providers; a list is not currently maintained.',
      'FreeText',
      {},
    ),
  ],
};

// ---------------------------------------------------------------------------
// 5) VagueVendor LLC — pervasive vague answers, generic policies -> expected HIGH (evidence-gap)
// ---------------------------------------------------------------------------
const vagueVendor: Scenario = {
  key: 'vaguevendor',
  vendor_name: 'VagueVendor LLC',
  sector: 'General SaaS (customer personal data)',
  questionnaire_type: 'SIG Lite',
  expected_risk: 'High',
  summary: 'Answers are pervasively vague with only generic policy documents and no implementation evidence.',
  data_categories: ['personal'],
  items: [
    mk(
      'Q1',
      'What personal data do you process?',
      'We process customer personal data to provide our service.',
      'FreeText',
      {},
    ),
    mk(
      'Q2',
      'Describe your security awareness training program.',
      'We provide security awareness training using industry-standard materials.',
      'FreeText',
      { evidence_text: 'Security awareness policy', evidence_location: 'Policy library' },
    ),
    mk(
      'Q3',
      'What is your data retention and deletion practice?',
      'We follow best practices for data retention and deletion.',
      'FreeText',
      { evidence_text: 'Data retention policy', evidence_location: 'Policy library' },
    ),
    mk(
      'Q4',
      'Describe your privacy governance program.',
      'Our privacy program follows industry-standard governance.',
      'FreeText',
      { evidence_text: 'Privacy policy', evidence_location: 'Policy library' },
    ),
    mk(
      'Q5',
      'How do you perform security testing?',
      'We perform security testing using industry best practices.',
      'Yes',
      { evidence_text: 'Security testing policy', evidence_location: 'Policy library' },
    ),
    mk(
      'Q6',
      'Describe your logging and monitoring.',
      'Logging and monitoring follow industry-standard approaches.',
      'FreeText',
      { evidence_text: 'Logging policy', evidence_location: 'Policy library' },
    ),
    mk('Q7', 'How is patching handled?', 'Patching is handled as needed following best practices.', 'FreeText', {
      evidence_text: 'Patch management policy',
      evidence_location: 'Policy library',
    }),
    mk(
      'Q8',
      'How do you handle data subject requests?',
      'We address data subject requests using reasonable measures.',
      'FreeText',
      { evidence_text: 'DSR policy', evidence_location: 'Policy library' },
    ),
    mk(
      'Q9',
      'How do you manage subprocessors?',
      'We manage subprocessors using commercially reasonable controls.',
      'FreeText',
      { evidence_text: 'Vendor management policy', evidence_location: 'Policy library' },
    ),
    mk('Q10', 'How are backups managed?', 'Backups follow industry-standard practices.', 'FreeText', {
      evidence_text: 'Backup policy',
      evidence_location: 'Policy library',
    }),
  ],
};

export const SCENARIOS: Scenario[] = [trustVault, dataFlow, secureHealth, cloudPay, vagueVendor];

export function getScenario(key: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.key === key);
}
