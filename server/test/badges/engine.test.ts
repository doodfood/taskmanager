import { describe, expect, it } from 'vitest';
import { buildEvaluationContext, mondayOf } from '../../src/badges/engine.js';
import { ALICE, BOB, EPOCH, earnedIds, evaluate, makeInstance, completedOn } from './badgeHelpers.js';

const AS_OF = '2026-07-23'; // mid W0

describe('engine — D7 strict partition', () => {
  it('each completion feeds exactly one timing class', () => {
    const early = makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, '2026-07-21') });
    const inWindow = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-21') });
    const late = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-21', ...completedOn(ALICE, '2026-07-23') });
    const ctx = buildEvaluationContext(ALICE, AS_OF, [early, inWindow, late], EPOCH);
    expect(ctx.currentWeek.earlyCount).toBe(1);
    expect(ctx.currentWeek.inWindowCount).toBe(1);
    expect(ctx.currentWeek.lateCount).toBe(1);
  });

  it('a mixed week earns one badge from each of the three timing categories', () => {
    const early = makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, '2026-07-21') });
    const inWindow = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-21') });
    const late = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-21', ...completedOn(ALICE, '2026-07-23') });
    const ids = earnedIds(ALICE, AS_OF, [early, inWindow, late]);
    expect(ids).toContain('eager-bunny-gold');
    expect(ids).toContain('amazing-worker-bronze');
    expect(ids).toContain('back-on-track-silver');
  });
});

describe('engine — one earned badge per category (D5)', () => {
  it('never earns two badges from the same category in one evaluation', () => {
    // 3 in-window completions qualify bronze+silver+gold simultaneously.
    const jobs = [
      makeInstance({ ...completedOn(ALICE, '2026-07-20') }),
      makeInstance({ ...completedOn(ALICE, '2026-07-21') }),
      makeInstance({ ...completedOn(ALICE, '2026-07-22') }),
    ];
    const earned = evaluate(ALICE, AS_OF, jobs);
    expect(earned.filter((b) => b.categoryId === 'amazing-worker').map((b) => b.badgeId)).toEqual([
      'amazing-worker-gold',
    ]);
  });
});

describe('engine — earned badges are derived, so they upgrade and downgrade fluidly (D1)', () => {
  const jobA = makeInstance({ id: 'a', ...completedOn(ALICE, '2026-07-21') });
  const jobB = makeInstance({ id: 'b', ...completedOn(ALICE, '2026-07-22') });

  it('upgrades bronze → silver as completions accumulate', () => {
    expect(earnedIds(ALICE, AS_OF, [jobA])).toContain('amazing-worker-bronze');
    const ids = earnedIds(ALICE, AS_OF, [jobA, jobB]);
    expect(ids).toContain('amazing-worker-silver');
    expect(ids).not.toContain('amazing-worker-bronze');
  });

  it('downgrades on reopen (a reopened job no longer counts)', () => {
    const reopenedB = { ...jobB, status: 'pending', completedBy: null, completedAt: null, pointsAwarded: null } as const;
    const ids = earnedIds(ALICE, AS_OF, [jobA, reopenedB]);
    expect(ids).toContain('amazing-worker-bronze');
    expect(ids).not.toContain('amazing-worker-silver');
  });

  it('reopening an in-window job after its due date immediately re-exposes the streak risk', () => {
    const completed = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-21', ...completedOn(ALICE, '2026-07-21') });
    expect(buildEvaluationContext(ALICE, '2026-07-23', [completed], EPOCH).currentWeek.clean).toBe(true);
    const reopened = { ...completed, status: 'pending', completedBy: null, completedAt: null } as const;
    expect(buildEvaluationContext(ALICE, '2026-07-23', [reopened], EPOCH).currentWeek.clean).toBe(false);
  });
});

describe('engine — week attribution (Monday-anchored, server-local)', () => {
  it('mondayOf anchors on Monday', () => {
    expect(mondayOf('2026-07-20')).toBe('2026-07-20'); // Monday itself
    expect(mondayOf('2026-07-26')).toBe('2026-07-20'); // Sunday
    expect(mondayOf('2026-07-27')).toBe('2026-07-27'); // next Monday
  });

  it('a completion at Sunday 23:59 counts in the old week; Monday 00:01 in the new week', () => {
    const sundayNight = makeInstance({
      occurrenceDate: '2026-07-25',
      dueDate: '2026-07-26',
      ...completedOn(ALICE, '2026-07-26', '23:59'),
    });
    const mondayMorning = makeInstance({
      occurrenceDate: '2026-07-27',
      dueDate: '2026-07-28',
      ...completedOn(ALICE, '2026-07-27', '00:01'),
    });

    // Evaluated as-of Sunday: the Sunday completion counts.
    expect(buildEvaluationContext(ALICE, '2026-07-26', [sundayNight], EPOCH).currentWeek.inWindowCount).toBe(1);
    // Evaluated as-of Monday: the Sunday completion is in last week's slice…
    const ctx = buildEvaluationContext(ALICE, '2026-07-27', [sundayNight, mondayMorning], EPOCH);
    expect(ctx.currentWeek.weekStart).toBe('2026-07-27');
    expect(ctx.currentWeek.inWindowCount).toBe(1); // only Monday's
    expect(ctx.pastWeeks[0].inWindowCount).toBe(1); // Sunday's
  });

  it('ignores completions dated after the as-of date (clock moved backwards)', () => {
    const future = makeInstance({ ...completedOn(ALICE, '2026-07-25') });
    expect(buildEvaluationContext(ALICE, '2026-07-23', [future], EPOCH).currentWeek.inWindowCount).toBe(0);
  });
});

describe('engine — epoch (Q11)', () => {
  it('completions before the epoch do not exist for the engine', () => {
    const preEpoch = makeInstance({
      occurrenceDate: '2026-07-13',
      dueDate: '2026-07-15',
      ...completedOn(ALICE, '2026-07-14'),
    });
    // As-of in the epoch week; the completion happened the week before the epoch.
    expect(earnedIds(ALICE, AS_OF, [preEpoch], '2026-07-20')).toEqual([]);
  });

  it('an as-of date before the epoch yields an empty evaluation', () => {
    const job = makeInstance({ ...completedOn(ALICE, '2026-07-21') });
    expect(evaluate(ALICE, '2026-07-13', [job], '2026-07-20')).toEqual([]);
    const ctx = buildEvaluationContext(ALICE, '2026-07-13', [job], '2026-07-20');
    expect(ctx.cleanStreak).toBe(0);
    expect(ctx.pastWeeks).toEqual([]);
  });
});

describe('engine — completer vs assignee', () => {
  it('completion badges credit completedBy; streak risk follows the auto-assignee', () => {
    // Auto-assigned to Alice; Bob completes it late.
    const job = makeInstance({
      assigneeId: ALICE,
      assignmentKind: 'auto',
      occurrenceDate: '2026-07-20',
      dueDate: '2026-07-21',
      ...completedOn(BOB, '2026-07-23'),
    });
    // Bob earned Back on track (he cleared the overdue job)…
    expect(earnedIds(BOB, AS_OF, [job])).toContain('back-on-track-silver');
    // …Alice did not, and Alice's clean streak is the one that breaks.
    expect(earnedIds(ALICE, AS_OF, [job])).not.toContain('back-on-track-silver');
    expect(buildEvaluationContext(ALICE, AS_OF, [job], EPOCH).currentWeek.clean).toBe(false);
    expect(buildEvaluationContext(BOB, AS_OF, [job], EPOCH).currentWeek.clean).toBe(true);
  });
});

describe('engine — multiple users evaluate independently', () => {
  it('the same history yields different badges per user', () => {
    const jobs = [
      makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24', ...completedOn(ALICE, '2026-07-21') }), // Alice early
      makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(BOB, '2026-07-22') }), // Bob in-window
    ];
    expect(earnedIds(ALICE, AS_OF, jobs)).toContain('eager-bunny-gold');
    expect(earnedIds(ALICE, AS_OF, jobs)).not.toContain('amazing-worker-bronze');
    expect(earnedIds(BOB, AS_OF, jobs)).toContain('amazing-worker-bronze');
    expect(earnedIds(BOB, AS_OF, jobs)).not.toContain('eager-bunny-gold');
  });
});
