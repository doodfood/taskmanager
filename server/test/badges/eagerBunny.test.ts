import { describe, expect, it } from 'vitest';
import { ALICE, BOB, earnedInCategory, makeInstance, completedOn } from './badgeHelpers.js';

const CATEGORY = 'eager-bunny';
const AS_OF = '2026-07-23'; // mid W0

/** An early completion: occurrence 07-22, due 07-24, completed on `date` (before occurrence). */
const earlyJob = (date: string) =>
  makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, date) });

describe('eager bunny (early completions, count badge)', () => {
  it('earns nothing with no early completions', () => {
    expect(earnedInCategory(ALICE, AS_OF, [], CATEGORY)).toBeNull();
  });

  it('earns gold with value 1 for a single early completion', () => {
    expect(earnedInCategory(ALICE, AS_OF, [earlyJob('2026-07-21')], CATEGORY)).toMatchObject({
      badgeId: 'eager-bunny-gold',
      tier: 'gold',
      value: 1,
    });
  });

  it('carries the count of early completions as its value (Q4)', () => {
    const jobs = [earlyJob('2026-07-20'), earlyJob('2026-07-21'), earlyJob('2026-07-21')];
    expect(earnedInCategory(ALICE, AS_OF, jobs, CATEGORY)).toMatchObject({ badgeId: 'eager-bunny-gold', value: 3 });
  });

  it('does not count a completion exactly on the start date (D7 boundary: in-window, not early)', () => {
    const onStart = makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, '2026-07-22') });
    expect(earnedInCategory(ALICE, AS_OF, [onStart], CATEGORY)).toBeNull();
  });

  it('credits the completer, not the assignee', () => {
    const doneByBob = makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(BOB, '2026-07-21') });
    expect(earnedInCategory(ALICE, AS_OF, [doneByBob], CATEGORY)).toBeNull();
    expect(earnedInCategory(BOB, AS_OF, [doneByBob], CATEGORY)?.value).toBe(1);
  });

  it('counts each user\'s own early completions separately', () => {
    const jobs = [
      makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, '2026-07-20') }),
      makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, '2026-07-21') }),
      makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(BOB, '2026-07-21') }),
    ];
    expect(earnedInCategory(ALICE, AS_OF, jobs, CATEGORY)?.value).toBe(2);
    expect(earnedInCategory(BOB, AS_OF, jobs, CATEGORY)?.value).toBe(1);
  });

  it('ignores early completions from other weeks', () => {
    const lastWeek = makeInstance({ occurrenceDate: '2026-07-15', dueDate: '2026-07-17', ...completedOn(ALICE, '2026-07-14') });
    expect(earnedInCategory(ALICE, AS_OF, [lastWeek], CATEGORY)).toBeNull();
  });
});
