import { describe, expect, it } from 'vitest';
import { ALICE, BOB, earnedInCategory, makeInstance, completedOn } from './badgeHelpers.js';

const CATEGORY = 'back-on-track';
const AS_OF = '2026-07-25'; // late W0

/** A late completion: occurrence 07-20, due 07-22, completed on `date` (after due). */
const lateJob = (date: string) =>
  makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, date) });

describe('back on track (late completions, count badge)', () => {
  it('earns nothing with no late completions', () => {
    expect(earnedInCategory(ALICE, AS_OF, [], CATEGORY)).toBeNull();
  });

  it('earns silver with value 1 for a single late completion', () => {
    expect(earnedInCategory(ALICE, AS_OF, [lateJob('2026-07-23')], CATEGORY)).toMatchObject({
      badgeId: 'back-on-track-silver',
      tier: 'silver',
      value: 1,
    });
  });

  it('carries the count of late completions as its value (Q4)', () => {
    const jobs = [lateJob('2026-07-23'), lateJob('2026-07-24')];
    expect(earnedInCategory(ALICE, AS_OF, jobs, CATEGORY)).toMatchObject({ badgeId: 'back-on-track-silver', value: 2 });
  });

  it('does not count a completion exactly on the due date (D7 boundary: in-window, not late)', () => {
    const onDue = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-22') });
    expect(earnedInCategory(ALICE, AS_OF, [onDue], CATEGORY)).toBeNull();
  });

  it('counts a completion one day after the due date as late', () => {
    expect(earnedInCategory(ALICE, AS_OF, [lateJob('2026-07-23')], CATEGORY)).not.toBeNull();
  });

  it('credits the completer, not the assignee (helping clear someone else\'s overdue job earns it)', () => {
    const doneByBob = makeInstance({ assigneeId: ALICE, occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(BOB, '2026-07-24') });
    expect(earnedInCategory(ALICE, AS_OF, [doneByBob], CATEGORY)).toBeNull();
    expect(earnedInCategory(BOB, AS_OF, [doneByBob], CATEGORY)?.value).toBe(1);
  });

  it('ignores late completions from other weeks', () => {
    const lastWeek = lateJob('2026-07-15');
    expect(earnedInCategory(ALICE, AS_OF, [lastWeek], CATEGORY)).toBeNull();
  });
});
