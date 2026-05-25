// Canonical control domains and the keyword sets used by the rule-based engine
// to classify free-text vendor responses/questions.

export interface ControlDomain {
  id: string;
  name: string;
  keywords: string[];
}

export const CONTROL_DOMAINS: ControlDomain[] = [
  {
    id: 'mfa',
    name: 'MFA',
    keywords: ['mfa', 'multi-factor', 'multi factor', 'two-factor', 'two factor', '2fa', 'otp', 'authenticator', 'one-time password'],
  },
  {
    id: 'iam',
    name: 'Identity & Access Management',
    keywords: ['access control', 'identity', 'iam', 'rbac', 'role-based', 'provisioning', 'deprovision', 'least privilege', 'user access', 'sso', 'single sign-on', 'authentication', 'authorization'],
  },
  {
    id: 'pam',
    name: 'Privileged Access Management',
    keywords: ['privileged', 'admin access', 'pam', 'root access', 'superuser', 'privileged access'],
  },
  {
    id: 'enc_rest',
    name: 'Encryption at Rest',
    // Generic encryption stems (encrypt/encryption/encrypted/cryptography) live
    // here so a non-specific "How is data encrypted?" classifies as encryption
    // (rather than Uncategorized); specific "in transit"/TLS phrasing still wins
    // the Encryption in Transit domain via higher-weighted multi-word matches.
    keywords: ['at rest', 'data at rest', 'aes', 'aes-256', 'disk encryption', 'encrypted storage', 'tde', 'transparent data encryption', 'encryption at rest', 'encryption', 'encrypt', 'encrypted', 'cryptography', 'cryptographic'],
  },
  {
    id: 'enc_transit',
    name: 'Encryption in Transit',
    keywords: ['in transit', 'data in transit', 'tls', 'ssl', 'https', 'transport encryption', 'encryption in transit', 'tls 1.2', 'tls 1.3'],
  },
  {
    id: 'logging',
    name: 'Logging & Monitoring',
    keywords: ['logging', 'log', 'monitoring', 'siem', 'audit log', 'alerting', 'soc', 'security operations', 'detection'],
  },
  {
    id: 'incident',
    name: 'Incident Response',
    keywords: ['incident response', 'incident', 'breach', 'ir plan', 'security incident', 'csirt', 'incident management'],
  },
  {
    id: 'vuln',
    name: 'Vulnerability Management',
    keywords: ['vulnerability', 'vuln', 'scanning', 'penetration test', 'pentest', 'pen test', 'cve', 'remediation', 'security testing'],
  },
  {
    id: 'patch',
    name: 'Patch Management',
    keywords: ['patch', 'patching', 'updates', 'hotfix', 'patch management', 'security updates'],
  },
  {
    id: 'backup',
    name: 'Backup & Recovery',
    keywords: ['backup', 'backups', 'restore', 'recovery point', 'rpo', 'data backup', 'snapshot'],
  },
  {
    id: 'bcp',
    name: 'Business Continuity',
    keywords: ['business continuity', 'bcp', 'continuity plan', 'resilience'],
  },
  {
    id: 'dr',
    name: 'Disaster Recovery',
    keywords: ['disaster recovery', 'dr plan', 'rto', 'failover', 'dr test', 'disaster'],
  },
  {
    id: 'privacy_gov',
    name: 'Data Privacy Governance',
    // "What personal data do you process?" and similar processing-scope questions
    // belong here rather than in the Uncategorized catch-all.
    keywords: ['privacy', 'data protection officer', 'dpo', 'privacy program', 'privacy governance', 'gdpr', 'records of processing', 'ropa', 'dpia', 'personal data', 'process personal data', 'processes personal data', 'personally identifiable information'],
  },
  {
    id: 'dsr',
    name: 'Data Subject Rights',
    keywords: ['data subject', 'dsar', 'right to access', 'right to erasure', 'right to be forgotten', 'data subject request', 'subject access'],
  },
  {
    id: 'retention',
    name: 'Data Retention & Deletion',
    keywords: ['retention', 'data retention', 'deletion', 'data deletion', 'disposal', 'purge', 'storage limitation', 'destroy'],
  },
  {
    id: 'tprm',
    name: 'Third-Party Risk Management',
    keywords: ['third party', 'third-party', 'subprocessor', 'sub-processor', 'subcontractor', 'vendor management', 'supplier', 'fourth party', 'subprocessors'],
  },
  {
    id: 'hipaa',
    name: 'HIPAA Safeguards',
    keywords: ['hipaa', 'phi', 'protected health information', 'ephi', 'baa', 'business associate', 'health information'],
  },
  {
    id: 'gdpr_proc',
    name: 'GDPR Processor Obligations',
    keywords: ['processor', 'data processing agreement', 'dpa', 'controller', 'article 28', 'standard contractual clauses', 'scc', 'cross-border transfer', 'international transfer'],
  },
];

const NORMALIZED = CONTROL_DOMAINS.map((d) => ({
  name: d.name,
  keywords: d.keywords.map((k) => k.toLowerCase()),
}));

/**
 * Returns the control-domain name whose keywords best match the supplied text.
 * Longer keyword phrases are weighted more heavily. Falls back to 'Uncategorized'.
 */
export function classifyByKeywords(text: string): string {
  const haystack = (text || '').toLowerCase();
  if (!haystack.trim()) return 'Uncategorized';

  let best = 'Uncategorized';
  let bestScore = 0;

  for (const domain of NORMALIZED) {
    let score = 0;
    for (const kw of domain.keywords) {
      if (haystack.includes(kw)) {
        // weight by number of words in the phrase so multi-word matches win
        score += kw.split(' ').length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = domain.name;
    }
  }
  return best;
}
