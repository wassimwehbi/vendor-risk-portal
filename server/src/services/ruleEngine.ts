import type {
  AnalysisProvider,
  Completeness,
  ControlStrength,
  DataCategory,
  EvidenceContext,
  EvidenceSufficiency,
  ItemAnalysis,
  QuestionnaireItem,
} from '../types';
import { classifyByKeywords, CONTROL_DOMAINS } from '../data/controlDomains';
import { getMapping } from './frameworkMapping';
import { scoreItem } from './riskScoring';

const VAGUE_PHRASES = [
  'industry-standard',
  'industry standard',
  'best practice',
  'best practices',
  'state-of-the-art',
  'state of the art',
  'robust',
  'appropriate measures',
  'reasonable measures',
  'as needed',
  'where appropriate',
  'we take security seriously',
  'various controls',
  'standard controls',
  'standard security',
  'follow best',
  'commercially reasonable',
];

const STRONG_SIGNALS = [
  'all users',
  'all employees',
  'all systems',
  'enforced for all',
  'company-wide',
  'company wide',
  'everywhere',
  'aes-256',
  'aes 256',
  'tls 1.2',
  'tls 1.3',
  'tls1.2',
  'tls1.3',
  'tested annually',
  'quarterly',
  'continuously',
  'iso 27001 certified',
  'soc 2 type ii',
];

const MEDIUM_SIGNALS = [
  'admins only',
  'admin only',
  'administrators only',
  'privileged users only',
  'only for admin',
  'partially',
  'some systems',
  'most ',
  'in progress',
  'planned',
];

const WEAK_SIGNALS = [
  'optional',
  'available upon request',
  'encouraged',
  'recommended',
  'where possible',
  'not yet',
  'no formal',
  'ad hoc',
  'ad-hoc',
];

interface CategorySignal {
  category: DataCategory;
  terms: string[];
}

const CATEGORY_SIGNALS: CategorySignal[] = [
  {
    category: 'phi',
    terms: [
      'phi',
      'protected health information',
      'ephi',
      'health information',
      'health data',
      'health record',
      'medical',
      'patient',
      'hipaa',
      'covered entit',
    ],
  },
  {
    category: 'sensitive_personal',
    terms: [
      'sensitive personal',
      'sensitive data',
      'biometric',
      'genetic',
      'racial',
      'religious',
      'sexual orientation',
      'special category',
    ],
  },
  { category: 'children', terms: ['children', 'child ', 'minor', 'under 13', 'coppa', "children's"] },
  {
    category: 'financial',
    terms: ['financial', 'payment', 'credit card', 'cardholder', 'pci', 'bank account', 'card data'],
  },
  { category: 'employee', terms: ['employee', 'payroll', 'hr data', 'staff records'] },
  {
    category: 'cross_border',
    terms: [
      'cross-border',
      'cross border',
      'international transfer',
      'third country',
      'outside the eu',
      'standard contractual clauses',
      'scc',
      'data transfer',
    ],
  },
  {
    category: 'subprocessors',
    terms: [
      'subprocessor',
      'sub-processor',
      'subcontractor',
      'fourth party',
      'third-party provider',
      'third party provider',
    ],
  },
  {
    category: 'personal',
    terms: [
      'personal data',
      'pii',
      'customer data',
      'data subject',
      'gdpr',
      'eu residents',
      'eu customers',
      'eu-based',
      'personally identifiable',
    ],
  },
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export function detectDataCategories(text: string): DataCategory[] {
  const found = new Set<DataCategory>();
  for (const sig of CATEGORY_SIGNALS) {
    if (includesAny(text, sig.terms)) found.add(sig.category);
  }
  return [...found];
}

function isExpiredAtDate(expirationDateStr: string | null, referenceDateStr?: string | null): boolean {
  if (!expirationDateStr) return false;
  const expiry = new Date(expirationDateStr);
  if (isNaN(expiry.getTime())) return false;
  const ref = referenceDateStr ? new Date(referenceDateStr) : new Date();
  if (isNaN(ref.getTime())) return expiry.getTime() < Date.now();
  return expiry.getTime() < ref.getTime();
}

function isEvidenceMisaligned(domain: string, evidence: EvidenceContext[]): boolean {
  const textualEvidence = evidence?.filter((e) => e.kind !== 'image' && e.text.trim().length > 200) ?? [];
  if (textualEvidence.length === 0) return false;
  const domainEntry = CONTROL_DOMAINS.find((d) => d.name === domain);
  if (!domainEntry || domainEntry.keywords.length === 0) return false;
  const combinedDocText = textualEvidence
    .map((e) => e.text)
    .join('\n')
    .toLowerCase();
  return !domainEntry.keywords.some((kw) => combinedDocText.includes(kw.toLowerCase()));
}

const DATE_PATTERN = /\d{4}[-_]\d{2}|q[1-4][-_ ]\d{4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
const GENERIC_SCREENSHOT_PREFIX = /^(screenshot|screen[-_ ]?shot|img|image|capture|snap)[\s_-]?\d*/i;

function screenshotLacksContext(evidence: EvidenceContext[]): boolean {
  const images = evidence?.filter((e) => e.kind === 'image') ?? [];
  if (images.length === 0) return false;
  return images.every((img) => {
    const name = img.name;
    const hasDate = DATE_PATTERN.test(name);
    const hasScope = !GENERIC_SCREENSHOT_PREFIX.test(name) && name.replace(/\.[^.]+$/, '').length > 12;
    return !hasDate && !hasScope;
  });
}

function assessStrength(item: QuestionnaireItem, text: string): ControlStrength {
  switch (item.response_type) {
    case 'No':
      return 'None';
    case 'N/A':
      return 'Medium';
    case 'Partial':
      return includesAny(text, VAGUE_PHRASES) ? 'Weak' : 'Medium';
    case 'Yes':
    case 'FreeText':
    default: {
      // Negative free-text ("we do not ...") signals an absent control.
      if (/\b(no |not |do not|don't|never|none|without)\b/.test(text) && item.response_type === 'FreeText') {
        return 'None';
      }
      if (includesAny(text, STRONG_SIGNALS)) return 'Strong';
      if (includesAny(text, WEAK_SIGNALS)) return 'Weak';
      if (includesAny(text, MEDIUM_SIGNALS)) return 'Medium';
      if (includesAny(text, VAGUE_PHRASES)) return 'Weak';
      return 'Medium';
    }
  }
}

function assessCompleteness(item: QuestionnaireItem, text: string): Completeness {
  const resp = (item.response || '').trim();
  if (item.response_type === 'No' || item.response_type === 'N/A') return 'Complete';
  if (resp.length === 0) return 'Missing';
  if (includesAny(text, VAGUE_PHRASES)) return 'Vague';
  if (item.response_type === 'Partial') return 'Partial';
  if (resp.length < 25 && !includesAny(text, STRONG_SIGNALS)) return 'Partial';
  return 'Complete';
}

const DOC_CONCRETE_SIGNALS = [
  'soc 2 type ii',
  'iso 27001',
  'certificate number',
  'aes-256',
  'tls 1.',
  'penetration test',
  'audit report',
];

export function assessEvidence(
  item: QuestionnaireItem,
  text: string,
  strength: ControlStrength,
  domain: string,
  evidence?: EvidenceContext[],
): EvidenceSufficiency {
  // Expiration always takes precedence over document content.
  if (isExpiredAtDate(item.expiration_date, item.relevant_date)) return 'Expired';

  const hasEvidence = Boolean(
    (item.evidence_text && item.evidence_text.trim()) || (item.evidence_location && item.evidence_location.trim()),
  );

  const docText =
    evidence
      ?.map((e) => e.text)
      .join('\n')
      .toLowerCase() ?? '';
  const docHasConcrete = docText.length > 0 && includesAny(docText, DOC_CONCRETE_SIGNALS);
  const docGenericOnly =
    docText.length > 0 &&
    /\b(policy|policies)\b/.test(docText) &&
    !/\b(screenshot|configuration|config|report|certificate|architecture|test result|audit|register|diagram|log)\b/.test(
      docText,
    );

  // Document with concrete signals corroborates the item's evidence claim.
  if (docHasConcrete && hasEvidence) return 'Sufficient';

  // Evidence text exists but has no keywords from the classified domain → Misaligned.
  // Gate on hasEvidence: only flag if this item actually claimed to provide evidence.
  if (hasEvidence && evidence && isEvidenceMisaligned(domain, evidence)) return 'Misaligned';

  // Screenshot evidence with no date or scope in filename → not auditable.
  if (hasEvidence && evidence && screenshotLacksContext(evidence)) return 'Insufficient';

  // Document present but carries only generic policy text.
  if (docGenericOnly) return 'Insufficient';

  // No useful document text — fall back to existing item-level logic.
  if (!hasEvidence) return 'None';
  const evidenceText = `${item.evidence_text ?? ''} ${item.evidence_location ?? ''}`.toLowerCase();
  const genericOnly =
    /\b(policy|policies)\b/.test(evidenceText) &&
    !/\b(screenshot|configuration|config|report|certificate|architecture|test result|audit|register|diagram|log)\b/.test(
      evidenceText,
    );
  if (includesAny(text, VAGUE_PHRASES) || strength === 'Weak') return 'Insufficient';
  if (genericOnly) return 'Insufficient';
  return 'Sufficient';
}

const FOLLOW_UPS: Record<string, string[]> = {
  MFA: [
    'Please confirm whether MFA is enforced for all users or only privileged/admin accounts.',
    'Which MFA methods are supported (e.g., authenticator app, hardware token, SMS)?',
    'Please provide evidence of MFA enforcement (configuration screenshot or policy).',
  ],
  'Encryption at Rest': [
    'Please confirm the encryption standard used for data at rest (e.g., AES-256).',
    'Does encryption at rest apply to backups and replicated environments?',
    'Please provide an encryption policy or system configuration evidence.',
  ],
  'Encryption in Transit': [
    'Please confirm the minimum TLS version enforced (e.g., TLS 1.2+).',
    'Is encryption applied to all internal and external data flows?',
    'Please provide configuration evidence of transport encryption.',
  ],
  'Incident Response': [
    'Please provide the most recent incident response test/tabletop results and date.',
    'What are your breach notification timelines and contractual commitments?',
    'Please share the incident response plan and escalation procedures.',
  ],
  'Business Continuity': [
    'Please provide the business continuity plan and its last review/test date.',
    'What are your defined RTO and RPO targets?',
  ],
  'Disaster Recovery': [
    'Please provide DR test results and the date of the most recent DR exercise.',
    'What are the documented RTO/RPO and failover arrangements?',
  ],
  'Third-Party Risk Management': [
    'Please provide the current list of subprocessors and how they are vetted.',
    'How are downstream subprocessors flowed down contractual security obligations?',
  ],
  'Data Retention & Deletion': [
    'Please specify retention periods by data category and the secure deletion method used.',
    'How is deletion verified and evidenced upon contract termination?',
  ],
  'Data Subject Rights': ['Describe your process and SLA for handling data subject access/erasure requests.'],
  'Vulnerability Management': [
    'What is your vulnerability scanning cadence and remediation SLA by severity?',
    'Please provide the most recent penetration test summary and date.',
  ],
  'Logging & Monitoring': ['What events are logged, how long are logs retained, and is a SIEM used?'],
  'GDPR Processor Obligations': [
    'Is a Data Processing Agreement (Art. 28) in place, and are cross-border transfers covered by SCCs?',
  ],
  'HIPAA Safeguards': [
    'Is a Business Associate Agreement (BAA) in place, and which technical safeguards apply to ePHI?',
  ],
};

const GENERIC_FOLLOW_UPS = [
  'Please provide specific details (scope, systems covered) and supporting evidence for this control.',
];

function buildFollowUps(
  domain: string,
  completeness: Completeness,
  strength: ControlStrength,
  evidence: EvidenceSufficiency,
): string[] {
  const out: string[] = [];
  const needsClarity =
    completeness === 'Vague' || completeness === 'Partial' || strength === 'Weak' || strength === 'None';
  if (needsClarity) {
    out.push(...(FOLLOW_UPS[domain] ?? GENERIC_FOLLOW_UPS).slice(0, 2));
  }
  if (evidence === 'None') {
    out.push('No evidence was provided — please supply documentation (policy, configuration, report, or certificate).');
  } else if (evidence === 'Expired') {
    out.push('The supporting certification/report appears expired — please provide a current, in-date version.');
  } else if (evidence === 'Insufficient') {
    out.push(
      'The evidence provided is generic or does not demonstrate implementation — please provide concrete proof.',
    );
  } else if (evidence === 'Misaligned') {
    out.push('The evidence does not appear to align with the response — please clarify or provide matching evidence.');
  }
  if (out.length === 0 && (FOLLOW_UPS[domain]?.length ?? 0) > 0) {
    out.push(FOLLOW_UPS[domain][0]);
  }
  return [...new Set(out)];
}

function buildFinding(
  strength: ControlStrength,
  completeness: Completeness,
  evidence: EvidenceSufficiency,
): { finding: string; rationale: string } {
  const parts: string[] = [];
  if (strength === 'None') parts.push('Control appears absent');
  else if (strength === 'Weak') parts.push('Weak control');
  else if (strength === 'Medium') parts.push('Partial coverage');
  else parts.push('Control appears in place');

  if (completeness === 'Vague') parts.push('answer is vague');
  else if (completeness === 'Missing') parts.push('no answer provided');
  else if (completeness === 'Partial') parts.push('answer lacks detail');

  if (evidence === 'None') parts.push('no evidence');
  else if (evidence === 'Expired') parts.push('evidence expired');
  else if (evidence === 'Insufficient') parts.push('evidence insufficient');
  else if (evidence === 'Misaligned') parts.push('evidence misaligned');
  else parts.push('evidence provided');

  const finding = parts.join('; ');
  const rationale = `Control strength assessed as ${strength}; completeness ${completeness}; evidence ${evidence}.`;
  return { finding, rationale };
}

async function analyzeItem(item: QuestionnaireItem, evidence?: EvidenceContext[]): Promise<ItemAnalysis> {
  const docText = evidence?.map((e) => e.text).join('\n') ?? '';
  const combined = `${item.question_text} ${item.response} ${item.vendor_comments ?? ''} ${docText}`.toLowerCase();
  const control_domain = classifyByKeywords(`${item.question_text} ${item.response}`);
  const data_categories = detectDataCategories(combined);
  const control_strength = assessStrength(item, combined);
  const completeness = assessCompleteness(item, combined);
  const evidence_sufficiency = assessEvidence(item, combined, control_strength, control_domain, evidence);
  const framework_mappings = getMapping(control_domain);
  const risk_level = scoreItem({
    control_strength,
    evidence_sufficiency,
    completeness,
    data_categories,
    control_domain,
  });
  const { finding, rationale } = buildFinding(control_strength, completeness, evidence_sufficiency);
  const follow_up_questions = buildFollowUps(control_domain, completeness, control_strength, evidence_sufficiency);

  return {
    control_domain,
    framework_mappings,
    completeness,
    control_strength,
    evidence_sufficiency,
    risk_level,
    ai_finding: finding,
    ai_rationale: rationale,
    follow_up_questions,
    data_categories,
  };
}

export const ruleEngine: AnalysisProvider = {
  name: 'rule',
  analyzeItem,
};
