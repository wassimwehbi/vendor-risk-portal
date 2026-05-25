import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRisk, pointsToLevel, scoreItem } from '../src/services/riskScoring';

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
