import { describe, expect, it } from 'vitest';
import { computeAward, EARLY_BONUS, MIN_AWARD } from '../src/scoring.js';

const START = '2026-07-25'; // Saturday
const DUE = '2026-07-26'; // Sunday

describe('computeAward — plan worked examples (10-point task due Sunday)', () => {
  it.each([
    ['2026-07-24', 15, 'early', 0], // Friday (before start) → 10 + 5
    ['2026-07-25', 10, 'on-time', 0], // Saturday (start) → 10
    ['2026-07-26', 10, 'on-time', 0], // Sunday (due date) → 10
    ['2026-07-27', 9, 'late', 1], // Monday → 10 − 1
    ['2026-07-29', 7, 'late', 3], // Wednesday → 10 − 3
    ['2026-07-31', 5, 'late', 5], // Friday → 10 − 5
    ['2026-08-09', 1, 'late', 14], // two weeks later → floor at 1
  ] as const)('completed %s → %d pts (%s, %d days late)', (completed, points, timing, daysLate) => {
    expect(computeAward(10, START, DUE, completed)).toEqual({ points, timing, daysLate });
  });
});

describe('computeAward — early completion', () => {
  it('grants the flat +5 bonus no matter how early', () => {
    for (const completed of ['2026-07-24', '2026-07-20', '2026-01-01']) {
      expect(computeAward(10, START, DUE, completed)).toEqual({ points: 10 + EARLY_BONUS, timing: 'early', daysLate: 0 });
    }
  });

  it('applies the bonus independently of the face value', () => {
    expect(computeAward(1, START, DUE, '2026-07-24').points).toBe(6);
    expect(computeAward(50, START, DUE, '2026-07-24').points).toBe(55);
    expect(computeAward(0, START, DUE, '2026-07-24').points).toBe(5);
  });
});

describe('computeAward — on-time and late', () => {
  it('grants the unchanged face value on the due date', () => {
    expect(computeAward(7, START, DUE, DUE)).toEqual({ points: 7, timing: 'on-time', daysLate: 0 });
  });

  it('penalises −1 per whole calendar day late', () => {
    expect(computeAward(10, START, DUE, '2026-07-28').daysLate).toBe(2);
    expect(computeAward(10, START, DUE, '2026-07-28').points).toBe(8);
  });

  it('compares calendar dates, not timestamps (date-only strings)', () => {
    expect(computeAward(10, START, DUE, '2026-07-27').timing).toBe('late');
    expect(computeAward(10, '2026-07-27', '2026-07-28', '2026-07-26').timing).toBe('early');
  });
});

describe('computeAward — the minimum-of-1 floor', () => {
  it('floors a hopelessly overdue task at 1, never 0 or negative', () => {
    expect(computeAward(3, START, DUE, '2026-12-31').points).toBe(MIN_AWARD);
    expect(computeAward(10, START, DUE, '2026-08-09').points).toBe(MIN_AWARD);
  });

  it('floors a 0-point task completed on time at 1', () => {
    expect(computeAward(0, START, DUE, DUE)).toEqual({ points: MIN_AWARD, timing: 'on-time', daysLate: 0 });
  });

  it('floors a 0-point task completed late at 1', () => {
    expect(computeAward(0, START, DUE, '2026-07-27')).toEqual({ points: MIN_AWARD, timing: 'late', daysLate: 1 });
  });
});
