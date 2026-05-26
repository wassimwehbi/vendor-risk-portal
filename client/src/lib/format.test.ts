import { describe, it, expect } from 'vitest';
import { formatDate, formatDay, RISK_CLASSES, STATUS_LABELS } from './format';

describe('formatDate', () => {
  it('returns an em dash for null', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('echoes back an unparseable string instead of NaN', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formats a valid ISO timestamp (locale-independent year check)', () => {
    const out = formatDate('2026-05-25T14:30:00Z');
    expect(out).toMatch(/2026/);
    expect(out).not.toBe('—');
  });
});

describe('formatDay', () => {
  it('returns an em dash for null', () => {
    expect(formatDay(null)).toBe('—');
  });

  it('formats a date', () => {
    expect(formatDay('2026-05-25T14:30:00Z')).toMatch(/2026/);
  });
});

describe('class/label maps', () => {
  it('RISK_CLASSES covers every risk level', () => {
    expect(Object.keys(RISK_CLASSES).sort()).toEqual(['Critical', 'High', 'Low', 'Medium']);
  });

  it('STATUS_LABELS maps each status to a human label', () => {
    expect(STATUS_LABELS.approved).toBe('Approved');
    expect(STATUS_LABELS.analyzed).toBe('Analyzed');
  });
});
