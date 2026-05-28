import type {
  Completeness,
  ControlStrength,
  DataCategory,
  EvidenceSufficiency,
  PersonalDataVolume,
  RiskLevel,
} from '../types';

/**
 * Preliminary risk scoring (weighted-factor model, per spec section 5).
 *
 * Factor weights (additive points):
 *   - Control strength:   None +4, Weak +3, Medium +1, Strong 0
 *   - Evidence:           None/Expired/Misaligned +2, Insufficient +1, Sufficient 0
 *   - Completeness:       Missing +3, Vague +2, Partial +1, Complete 0
 *   - Critical control domain (MFA, encryption, incident response, IAM/PAM,
 *     business continuity / DR) when the control is None or Weak: +2
 *   - Data sensitivity:   PHI / sensitive / financial / children +2;
 *                         personal / cross-border +1; otherwise 0
 *   - Internet-facing system:  true +2; false 0
 *   - Personal data volume:   high +3; medium +1; low/null 0
 *
 * Thresholds -> Low (<3), Medium (3-4), High (5-7), Critical (>=8).
 *
 * NOTE: this produces a PRELIMINARY level only. The final decision is always
 * made by a human analyst.
 */

const CRITICAL_DOMAINS = new Set<string>([
  'MFA',
  'Encryption at Rest',
  'Encryption in Transit',
  'Incident Response',
  'Identity & Access Management',
  'Privileged Access Management',
  'Business Continuity',
  'Disaster Recovery',
]);

const STRENGTH_POINTS: Record<ControlStrength, number> = {
  None: 4,
  Weak: 3,
  Medium: 1,
  Strong: 0,
};

const EVIDENCE_POINTS: Record<EvidenceSufficiency, number> = {
  None: 2,
  Expired: 2,
  Misaligned: 2,
  Insufficient: 1,
  Sufficient: 0,
};

const COMPLETENESS_POINTS: Record<Completeness, number> = {
  Missing: 3,
  Vague: 2,
  Partial: 1,
  Complete: 0,
};

function dataSensitivityPoints(categories: DataCategory[]): number {
  const high: DataCategory[] = ['phi', 'sensitive_personal', 'financial', 'children'];
  const medium: DataCategory[] = ['personal', 'cross_border', 'data_subject_requests'];
  if (categories.some((c) => high.includes(c))) return 2;
  if (categories.some((c) => medium.includes(c))) return 1;
  return 0;
}

function internetFacingPoints(internet_facing?: boolean): number {
  return internet_facing ? 2 : 0;
}

function personalDataVolumePoints(volume?: PersonalDataVolume | null): number {
  if (volume === 'high') return 3;
  if (volume === 'medium') return 1;
  return 0;
}

export interface ScoreInput {
  control_strength: ControlStrength;
  evidence_sufficiency: EvidenceSufficiency;
  completeness: Completeness;
  data_categories: DataCategory[];
  control_domain: string;
  internet_facing?: boolean;
  personal_data_volume?: PersonalDataVolume | null;
}

export function scoreItemPoints(input: ScoreInput): number {
  let points = 0;
  points += STRENGTH_POINTS[input.control_strength];
  points += EVIDENCE_POINTS[input.evidence_sufficiency];
  points += COMPLETENESS_POINTS[input.completeness];
  if (
    CRITICAL_DOMAINS.has(input.control_domain) &&
    (input.control_strength === 'None' || input.control_strength === 'Weak')
  ) {
    points += 2;
  }
  points += dataSensitivityPoints(input.data_categories);
  points += internetFacingPoints(input.internet_facing);
  points += personalDataVolumePoints(input.personal_data_volume);
  return points;
}

export function pointsToLevel(points: number): RiskLevel {
  if (points >= 8) return 'Critical';
  if (points >= 5) return 'High';
  if (points >= 3) return 'Medium';
  return 'Low';
}

export function scoreItem(input: ScoreInput): RiskLevel {
  return pointsToLevel(scoreItemPoints(input));
}

const LEVEL_RANK: Record<RiskLevel, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
const RANK_LEVEL: RiskLevel[] = ['Low', 'Low', 'Medium', 'High', 'Critical'];

/**
 * Aggregate per-item risk into an overall preliminary risk level using a
 * worst-case approach (vendor risk is driven by its weakest controls).
 */
export function aggregateRisk(levels: RiskLevel[]): RiskLevel {
  if (levels.length === 0) return 'Low';
  const maxRank = Math.max(...levels.map((l) => LEVEL_RANK[l]));
  return RANK_LEVEL[maxRank];
}
