import { describe, expect, it } from 'vitest';
import { buildEvaluationContext } from '../../src/badges/engine.js';
import { ALICE, BOB, EPOCH, W, earnedIds, earnedInCategory, makeInstance, completedOn } from './badgeHelpers.js';

const CATEGORY = 'streak-superstar';

/** Sunday of week n (the as-of date the Monday award ceremony evaluates at). */
const sundayOf = (week: number): string => {
  const [y, m, d] = W[week].split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10);
};

/** Auto-assigned job due Wednesday of week n, completed in-window that day → clean, not early. */
const cleanJob = (week: number, overrides = {}) => {
  const [y, m, d] = W[week].split('-').map(Number);
  const at = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  return makeInstance({ occurrenceDate: at(0), dueDate: at(2), ...completedOn(ALICE, at(2)), ...overrides });
};

/** Auto-assigned job occurring Wednesday of week n (due Friday), completed Monday → early. */
const earlyJob = (week: number, overrides = {}) => {
  const [y, m, d] = W[week].split('-').map(Number);
  const at = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  return makeInstance({ occurrenceDate: at(2), dueDate: at(4), ...completedOn(ALICE, at(0)), ...overrides });
};

describe('streak superstar — clean (Amazing worker) streak', () => {
  it('earns nothing for a single clean week', () => {
    expect(earnedInCategory(ALICE, sundayOf(0), [cleanJob(0)], CATEGORY)).toBeNull();
  });

  it('earns bronze after 2 consecutive clean weeks, value = 2', () => {
    const jobs = [cleanJob(0), cleanJob(1)];
    expect(earnedInCategory(ALICE, sundayOf(1), jobs, CATEGORY)).toMatchObject({
      badgeId: 'streak-amazing-bronze',
      tier: 'bronze',
      value: 2,
    });
  });

  it('grows silver at 3 weeks and gold at 4, value tracking the streak (RQ1)', () => {
    expect(earnedInCategory(ALICE, sundayOf(2), [cleanJob(0), cleanJob(1), cleanJob(2)], CATEGORY)).toMatchObject({
      badgeId: 'streak-amazing-silver',
      value: 3,
    });
    const four = [cleanJob(0), cleanJob(1), cleanJob(2), cleanJob(3)];
    expect(earnedInCategory(ALICE, sundayOf(3), four, CATEGORY)).toMatchObject({
      badgeId: 'streak-amazing-gold',
      value: 4,
    });
    // Beyond 4 weeks: tier stays gold, value keeps growing.
    const five = [...four, cleanJob(4)];
    expect(earnedInCategory(ALICE, sundayOf(4), five, CATEGORY)).toMatchObject({
      badgeId: 'streak-amazing-gold',
      value: 5,
    });
  });

  it('a late completion breaks the streak in its own week only', () => {
    const late = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-24') });
    // W0 late, W1 clean → at the end of W1 the streak is just 1 → nothing.
    expect(earnedInCategory(ALICE, sundayOf(1), [late, cleanJob(1)], CATEGORY)).toBeNull();
    // W0 late, W1 + W2 clean → streak 2 → bronze (the old broken week is behind the run).
    expect(earnedInCategory(ALICE, sundayOf(2), [late, cleanJob(1), cleanJob(2)], CATEGORY)).toMatchObject({
      badgeId: 'streak-amazing-bronze',
      value: 2,
    });
  });

  it('the plan\'s key case: 1 in-window + 1 overdue job — earns Amazing worker, breaks the clean streak', () => {
    const inWindow = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-21') });
    const late = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-23', ...completedOn(ALICE, '2026-07-25') });
    const ids = earnedIds(ALICE, sundayOf(0), [inWindow, late]);
    expect(ids).toContain('amazing-worker-bronze');
    expect(ids).toContain('back-on-track-silver');
    expect(ids).not.toContain('streak-amazing-bronze');
    // The following week starts the streak from scratch (current week clean so far, last week dirty).
    const ctx = buildEvaluationContext(ALICE, W[1], [inWindow, late], EPOCH);
    expect(ctx.cleanStreak).toBe(1);
  });

  it('empty weeks are clean AND all-early (vacuous truth, Q7) — a quiet household keeps streaks alive', () => {
    // No jobs at all for three weeks → both streaks reach 3; the eager line
    // (priority 2) suppresses the amazing line as usual (D5).
    const ctx = buildEvaluationContext(ALICE, sundayOf(2), [], EPOCH);
    expect(ctx.cleanStreak).toBe(3);
    expect(ctx.allEarlyStreak).toBe(3);
    expect(earnedInCategory(ALICE, sundayOf(2), [], CATEGORY)).toMatchObject({
      badgeId: 'streak-eager-silver',
      value: 3,
    });
  });

  it('a pending job breaks the streak as soon as its due date is reached', () => {
    const job = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22' }); // pending
    expect(buildEvaluationContext(ALICE, '2026-07-21', [job], EPOCH).currentWeek.clean).toBe(true); // before due
    expect(buildEvaluationContext(ALICE, '2026-07-22', [job], EPOCH).currentWeek.clean).toBe(false); // due date reached
    expect(buildEvaluationContext(ALICE, '2026-07-23', [job], EPOCH).currentWeek.clean).toBe(false); // overdue
    // Completing it in-window restores the week (earned badges are fluid, D1).
    const done = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-22') });
    expect(buildEvaluationContext(ALICE, '2026-07-22', [done], EPOCH).currentWeek.clean).toBe(true);
  });

  it('a job due in the future does not break the current week yet', () => {
    const job = makeInstance({ occurrenceDate: '2026-07-22', dueDate: '2026-07-24' });
    expect(buildEvaluationContext(ALICE, '2026-07-22', [job], EPOCH).currentWeek.clean).toBe(true);
  });

  it('a job due Sunday and still pending at the ceremony counts as unfinished by week\'s end', () => {
    const job = makeInstance({ occurrenceDate: '2026-07-20', dueDate: sundayOf(0) }); // due 2026-07-26
    expect(buildEvaluationContext(ALICE, sundayOf(0), [job], EPOCH).currentWeek.clean).toBe(false);
  });
});

describe('streak superstar — all-early (Eager bunny) streak', () => {
  it('earns nothing for a single all-early week', () => {
    expect(earnedInCategory(ALICE, sundayOf(0), [earlyJob(0)], CATEGORY)).toBeNull();
  });

  it('earns bronze/silver/gold at 2/3/4 consecutive all-early weeks', () => {
    expect(earnedInCategory(ALICE, sundayOf(1), [earlyJob(0), earlyJob(1)], CATEGORY)).toMatchObject({
      badgeId: 'streak-eager-bronze',
      value: 2,
    });
    expect(earnedInCategory(ALICE, sundayOf(2), [earlyJob(0), earlyJob(1), earlyJob(2)], CATEGORY)).toMatchObject({
      badgeId: 'streak-eager-silver',
      value: 3,
    });
    expect(
      earnedInCategory(ALICE, sundayOf(3), [earlyJob(0), earlyJob(1), earlyJob(2), earlyJob(3)], CATEGORY),
    ).toMatchObject({ badgeId: 'streak-eager-gold', value: 4 });
  });

  it('an in-window completion breaks all-early but keeps the week clean', () => {
    const jobs = [cleanJob(0), cleanJob(1)]; // in-window, never early
    const ctx = buildEvaluationContext(ALICE, sundayOf(1), jobs, EPOCH);
    expect(ctx.allEarlyStreak).toBe(0);
    expect(ctx.cleanStreak).toBe(2);
    expect(earnedInCategory(ALICE, sundayOf(1), jobs, CATEGORY)?.badgeId).toBe('streak-amazing-bronze');
  });

  it('a pending job breaks all-early only once its start date arrives (it can no longer be early)', () => {
    const job = makeInstance({ occurrenceDate: '2026-07-24', dueDate: '2026-07-25' }); // pending
    expect(buildEvaluationContext(ALICE, '2026-07-22', [job], EPOCH).currentWeek.allEarly).toBe(true); // could still be done early
    expect(buildEvaluationContext(ALICE, '2026-07-24', [job], EPOCH).currentWeek.allEarly).toBe(false); // start date reached
    // ...but the week is still clean (the job isn't due yet).
    expect(buildEvaluationContext(ALICE, '2026-07-24', [job], EPOCH).currentWeek.clean).toBe(true);
  });

  it('an early completion by someone else still saves the assignee\'s all-early week', () => {
    // Auto-assigned to Alice but Bob knocked it out early: Alice's streak holds;
    // the completion-credit badge goes to Bob.
    const job = makeInstance({
      assigneeId: ALICE,
      assignmentKind: 'auto',
      occurrenceDate: '2026-07-22',
      dueDate: '2026-07-24',
      ...completedOn(BOB, '2026-07-21'),
    });
    expect(buildEvaluationContext(ALICE, sundayOf(0), [job], EPOCH).currentWeek.allEarly).toBe(true);
    expect(earnedIds(ALICE, sundayOf(0), [job])).not.toContain('eager-bunny-gold');
    expect(earnedIds(BOB, sundayOf(0), [job])).toContain('eager-bunny-gold');
  });
});

describe('streak superstar — D5 suppression and tier tie-break', () => {
  it('the Eager streak line suppresses the Amazing streak line when both qualify (Q2)', () => {
    // Two all-early weeks → both lines qualify (all-early implies clean), only the
    // more valuable Eager badge (priority 2) is earned.
    const ids = earnedIds(ALICE, sundayOf(1), [earlyJob(0), earlyJob(1)]);
    expect(ids).toContain('streak-eager-bronze');
    expect(ids).not.toContain('streak-amazing-bronze');
  });

  it('earns exactly one badge from the category even when several tiers qualify', () => {
    // Four all-early weeks qualify all six streak badges; only eager-gold survives.
    const earned = earnedIds(ALICE, sundayOf(3), [earlyJob(0), earlyJob(1), earlyJob(2), earlyJob(3)]);
    expect(earned.filter((id) => id.startsWith('streak-'))).toEqual(['streak-eager-gold']);
  });

  it('within one line, the highest qualifying tier wins (tie on priority)', () => {
    const jobs = [cleanJob(0), cleanJob(1), cleanJob(2), cleanJob(3)];
    const earned = earnedIds(ALICE, sundayOf(3), jobs).filter((id) => id.startsWith('streak-'));
    expect(earned).toEqual(['streak-amazing-gold']);
  });
});

describe('streak superstar — assignment kind (D8)', () => {
  it('a late MANUAL job does not break the clean streak', () => {
    const manualLate = makeInstance({
      assignmentKind: 'manual',
      occurrenceDate: '2026-07-20',
      dueDate: '2026-07-22',
      ...completedOn(ALICE, '2026-07-25'),
    });
    expect(buildEvaluationContext(ALICE, sundayOf(0), [manualLate], EPOCH).currentWeek.clean).toBe(true);
  });

  it('an overdue pending MANUAL job does not break the clean streak (reassignment cleansing, RQ3)', () => {
    const manualPending = makeInstance({ assignmentKind: 'manual', occurrenceDate: '2026-07-20', dueDate: '2026-07-22' });
    expect(buildEvaluationContext(ALICE, sundayOf(0), [manualPending], EPOCH).currentWeek.clean).toBe(true);
  });

  it('a late ANYONE job does not break the clean streak', () => {
    const anyoneLate = makeInstance({
      assigneeId: null,
      assignmentKind: 'none',
      occurrenceDate: '2026-07-20',
      dueDate: '2026-07-22',
      ...completedOn(ALICE, '2026-07-25'),
    });
    expect(buildEvaluationContext(ALICE, sundayOf(0), [anyoneLate], EPOCH).currentWeek.clean).toBe(true);
  });

  it('an in-window MANUAL job does not break all-early (manual jobs are ignored entirely)', () => {
    const manual = makeInstance({
      assignmentKind: 'manual',
      occurrenceDate: '2026-07-20',
      dueDate: '2026-07-22',
      ...completedOn(ALICE, '2026-07-21'),
    });
    expect(buildEvaluationContext(ALICE, sundayOf(0), [manual], EPOCH).currentWeek.allEarly).toBe(true);
  });

  it('an AUTO job late breaks the streak of the auto-assignee, not of other users', () => {
    const late = makeInstance({
      assigneeId: ALICE,
      assignmentKind: 'auto',
      occurrenceDate: '2026-07-20',
      dueDate: '2026-07-22',
      ...completedOn(ALICE, '2026-07-25'),
    });
    expect(buildEvaluationContext(ALICE, sundayOf(0), [late], EPOCH).currentWeek.clean).toBe(false);
    expect(buildEvaluationContext(BOB, sundayOf(0), [late], EPOCH).currentWeek.clean).toBe(true);
  });
});

describe('streak superstar — epoch clipping (Q11)', () => {
  it('weeks before the epoch count as nothing, not vacuous-true', () => {
    // Epoch = W1 Monday. W0 is dirty (late job) but pre-epoch → ignored; the
    // streak can only start accumulating from W1.
    const dirtyW0 = makeInstance({ occurrenceDate: '2026-07-20', dueDate: '2026-07-22', ...completedOn(ALICE, '2026-07-25') });
    const jobs = [dirtyW0, cleanJob(1), cleanJob(2)];
    const ctx = buildEvaluationContext(ALICE, sundayOf(2), jobs, W[1]);
    expect(ctx.cleanStreak).toBe(2); // W2 + W1; W0 does not exist
    expect(ctx.pastWeeks.map((w) => w.weekStart)).toEqual([W[1]]);
    expect(earnedInCategory(ALICE, sundayOf(2), jobs, CATEGORY, W[1])?.badgeId).toBe('streak-amazing-bronze');
    // With the epoch at W0 the dirty pre-epoch week becomes visible: the streak
    // still reads 2 (W2 + W1 clean, the run stops at dirty W0), but W0 is
    // present in the slices and flagged unclean.
    const full = buildEvaluationContext(ALICE, sundayOf(2), jobs, EPOCH);
    expect(full.cleanStreak).toBe(2);
    expect(full.pastWeeks[1].weekStart).toBe(W[0]);
    expect(full.pastWeeks[1].clean).toBe(false);
  });

  it('the earliest possible streak award is bronze at the rollover ending the second post-epoch week', () => {
    const jobs = [cleanJob(0), cleanJob(1)];
    // End of the first post-epoch week: streak 1 → nothing.
    expect(earnedInCategory(ALICE, sundayOf(0), jobs, CATEGORY)).toBeNull();
    // End of the second post-epoch week: streak 2 → bronze.
    expect(earnedInCategory(ALICE, sundayOf(1), jobs, CATEGORY)?.badgeId).toBe('streak-amazing-bronze');
  });
});
