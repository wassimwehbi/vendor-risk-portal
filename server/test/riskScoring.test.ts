import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRisk, pointsToLevel, scoreItem, scoreItemPoints } from '../src/services/riskScoring';
import type { DataCategory } from '../src/types';

test('strong, well-evidenced control with low-sensitivity data is Low', () => {
  const level = scoreItem({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: ['personal'],
    control_domain: 'MFA',
  });
  assert.equal(level, 'Low');
});

test('absent MFA control on a PHI vendor is Critical', () => {
  const level = scoreItem({
    control_strength: 'None',
    evidence_sufficiency: 'None',
    completeness: 'Complete',
    data_categories: ['phi'],
    control_domain: 'MFA',
  });
  assert.equal(level, 'Critical');
});

test('partial control with no evidence on PHI vendor is High', () => {
  const level = scoreItem({
    control_strength: 'Medium',
    evidence_sufficiency: 'None',
    completeness: 'Partial',
    data_categories: ['phi'],
    control_domain: 'Business Continuity',
  });
  assert.equal(level, 'High');
});

test('vague answer with generic evidence in a non-critical domain is High', () => {
  const level = scoreItem({
    control_strength: 'Weak',
    evidence_sufficiency: 'Insufficient',
    completeness: 'Vague',
    data_categories: ['personal'],
    control_domain: 'Data Retention & Deletion',
  });
  assert.equal(level, 'High');
});

test('expired evidence raises risk', () => {
  const withExpired = scoreItem({
    control_strength: 'Medium',
    evidence_sufficiency: 'Expired',
    completeness: 'Complete',
    data_categories: ['financial'],
    control_domain: 'Logging & Monitoring',
  });
  assert.equal(withExpired, 'High');
});

test('pointsToLevel thresholds', () => {
  assert.equal(pointsToLevel(0), 'Low');
  assert.equal(pointsToLevel(2), 'Low');
  assert.equal(pointsToLevel(3), 'Medium');
  assert.equal(pointsToLevel(4), 'Medium');
  assert.equal(pointsToLevel(5), 'High');
  assert.equal(pointsToLevel(7), 'High');
  assert.equal(pointsToLevel(8), 'Critical');
  assert.equal(pointsToLevel(12), 'Critical');
});

test('aggregateRisk uses worst case', () => {
  assert.equal(aggregateRisk(['Low', 'Low', 'Medium']), 'Medium');
  assert.equal(aggregateRisk(['Low', 'High', 'Medium']), 'High');
  assert.equal(aggregateRisk(['Medium', 'Critical']), 'Critical');
  assert.equal(aggregateRisk([]), 'Low');
});

test('internet-facing adds 2 pts (Medium weight)', () => {
  const withExposure = scoreItemPoints({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: [],
    control_domain: 'MFA',
    internet_facing: true,
  });
  assert.equal(withExposure, 2);

  const withoutExposure = scoreItemPoints({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: [],
    control_domain: 'MFA',
    internet_facing: false,
  });
  assert.equal(withoutExposure, 0);
});

test('personal_data_volume high adds 3 pts, medium adds 1 pt', () => {
  const base = {
    control_strength: 'Strong' as const,
    evidence_sufficiency: 'Sufficient' as const,
    completeness: 'Complete' as const,
    data_categories: [] as DataCategory[],
    control_domain: 'Data Privacy Governance',
  };
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: 'high' }), 3);
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: 'medium' }), 1);
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: 'low' }), 0);
  assert.equal(scoreItemPoints({ ...base, personal_data_volume: null }), 0);
  assert.equal(scoreItemPoints({ ...base }), 0);
});

test('well-controlled internet-facing system with high personal data volume scores High', () => {
  const level = scoreItem({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: ['personal'],
    control_domain: 'MFA',
    internet_facing: true,
    personal_data_volume: 'high',
  });
  // 0+0+0+0+1(personal)+2(internet)+3(high-volume) = 6 -> High
  assert.equal(level, 'High');
});

test('absent MFA on internet-facing PHI vendor with high volume is Critical', () => {
  const level = scoreItem({
    control_strength: 'None',
    evidence_sufficiency: 'None',
    completeness: 'Missing',
    data_categories: ['phi'],
    control_domain: 'MFA',
    internet_facing: true,
    personal_data_volume: 'high',
  });
  // 4+2+3+2(critical penalty)+2(phi)+2(internet)+3(high-volume) = 18 -> Critical
  assert.equal(level, 'Critical');
});

test('existing tests are unaffected when new fields are absent', () => {
  const level = scoreItem({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: ['personal'],
    control_domain: 'MFA',
  });
  assert.equal(level, 'Low'); // 0+0+0+0+1 = 1 -> Low (unchanged)
});

test('data_subject_requests alone scores 1 point (medium tier)', () => {
  const pts = scoreItemPoints({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: ['data_subject_requests'],
    control_domain: 'Data Subject Rights',
  });
  assert.equal(pts, 1);
});

test('phi + data_subject_requests scores 2 points (high tier wins)', () => {
  const pts = scoreItemPoints({
    control_strength: 'Strong',
    evidence_sufficiency: 'Sufficient',
    completeness: 'Complete',
    data_categories: ['phi', 'data_subject_requests'],
    control_domain: 'Data Subject Rights',
  });
  assert.equal(pts, 2);
});
