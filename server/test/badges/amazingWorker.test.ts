import { describe, expect, it } from 'vitest';
import { ALICE, BOB, earnedInCategory, makeInstance, completedOn } from './badgeHelpers.js';

const CATEGORY = 'amazing-worker';
const AS_OF = '2026-07-23'; // mid W0

/** An in-window completion: occurrence 07-20, due 07-22, completed on `date`. */
const inWindowJob = (date: string) =>
  makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, date) });

describe('amazing worker (in-window completions)', () => {
  it('earns nothing with no completions', () => {
    expect(earnedInCategory(ALICE, AS_OF, [], CATEGORY)).toBeNull();
    expect(earnedInCategory(ALICE, AS_OF, [makeInstance()], CATEGORY)).toBeNull(); // pending job
  });

  it('bronze at 1, silver at 2, gold at 3 in-window completions', () => {
    expect(earnedInCategory(ALICE, AS_OF, [inWindowJob('2026-07-21')], CATEGORY)).toMatchObject({
      badgeId: 'amazing-worker-bronze',
      value: null, // plain badge carries no value
    });
    expect(
      earnedInCategory(ALICE, AS_OF, [inWindowJob('2026-07-21'), inWindowJob('2026-07-22')], CATEGORY),
    ).toMatchObject({ badgeId: 'amazing-worker-silver' });
    expect(
      earnedInCategory(
        ALICE,
        AS_OF,
        [inWindowJob('2026-07-20'), inWindowJob('2026-07-21'), inWindowJob('2026-07-22')],
        CATEGORY,
      ),
    ).toMatchObject({ badgeId: 'amazing-worker-gold' });
  });

  it('awards only one badge (the highest tier) even far past gold', () => {
    const jobs = Array.from({ length: 6 }, () => inWindowJob('2026-07-21'));
    const earned = earnedInCategory(ALICE, AS_OF, jobs, CATEGORY);
    expect(earned).toMatchObject({ badgeId: 'amazing-worker-gold', tier: 'gold' });
  });

  it('counts a completion exactly on the start date as in-window (D7 boundary)', () => {
    const job = makeInstance({ occurrenceDate: '2026-07-21', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-21') });
    expect(earnedInCategory(ALICE, AS_OF, [job], CATEGORY)?.badgeId).toBe('amazing-worker-bronze');
  });

  it('counts a completion exactly on the due date as in-window (D7 boundary)', () => {
    const job = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-22') });
    expect(earnedInCategory(ALICE, AS_OF, [job], CATEGORY)?.badgeId).toBe('amazing-worker-bronze');
  });

  it('does not count early completions (they feed Eager bunny only, D7)', () => {
    const early = makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, '2026-07-21') });
    expect(earnedInCategory(ALICE, AS_OF, [early], CATEGORY)).toBeNull();
  });

  it('does not count late completions (they feed Back on track only, D7)', () => {
    const late = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-21', ...completedOn(ALICE, '2026-07-23') });
    expect(earnedInCategory(ALICE, AS_OF, [late], CATEGORY)).toBeNull();
  });

  it('credits the completer, not the assignee', () => {
    const doneByBob = makeInstance({ assigneeId: ALICE, ...completedOn(BOB, '2026-07-21') });
    expect(earnedInCategory(ALICE, AS_OF, [doneByBob], CATEGORY)).toBeNull();
    expect(earnedInCategory(BOB, AS_OF, [doneByBob], CATEGORY)?.badgeId).toBe('amazing-worker-bronze');
  });

  it('ignores completions from other weeks', () => {
    const lastWeek = inWindowJob('2026-07-13'); // week before the epoch week is clipped anyway
    expect(earnedInCategory(ALICE, AS_OF, [lastWeek], CATEGORY)).toBeNull();
    const nextWeek = inWindowJob('2026-07-29');
    expect(earnedInCategory(ALICE, AS_OF, [nextWeek], CATEGORY)).toBeNull();
  });

  it('earns badges for manual and anyone jobs too (D8: manual can credit)', () => {
    const manual = makeInstance({ assignmentKind: 'manual', ...completedOn(ALICE, '2026-07-21') });
    const anyone = makeInstance({ assigneeId: null, assignmentKind: 'none', ...completedOn(ALICE, '2026-07-21') });
    expect(earnedInCategory(ALICE, AS_OF, [manual], CATEGORY)?.badgeId).toBe('amazing-worker-bronze');
    expect(earnedInCategory(ALICE, AS_OF, [anyone], CATEGORY)?.badgeId).toBe('amazing-worker-bronze');
  });
});
