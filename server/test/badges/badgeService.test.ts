import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setSpoofedDate } from '../../src/clock.js';
import { createBadgeService } from '../../src/services/badgeService.js';
import { createUserService } from '../../src/services/userService.js';
import { JsonFileStorage } from '../../src/storage/JsonFileStorage.js';
import type { TestContext } from '../helpers.js';
import { makeTestContext } from '../helpers.js';
import { makeInstance, completedOn, W } from './badgeHelpers.js';

/**
 * Rollover service tests against real JSON storage with a spoofed clock.
 * makeTestContext boots at Monday 2026-07-20 (W0) 09:00 local.
 *
 * Week anchors: W0 07-20, W1 07-27, W2 08-03, W3 08-10, W4 08-17, W5 08-24.
 */
let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

const monday = (week: number, time = '09:00') => setSpoofedDate(`${W[week]}T${time}:00`);

/** Alice's auto-assigned job, due Wednesday of week n, completed in-window. */
const cleanJob = (ctx: TestContext, week: number) => {
  const [y, m, d] = W[week].split('-').map(Number);
  const at = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  return makeInstance({
    assigneeId: ctx.users[0].id,
    assignmentKind: 'auto',
    occurrenceDate: at(0),
    dueDate: at(2),
    ...completedOn(ctx.users[0].id, at(2)),
  });
};

describe('badgeService.rolloverIfNewWeek', () => {
  it('initialises the watermark + epoch on first run and awards nothing (Q11)', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    // A qualifying completion already exists this week (completed today, in-window)…
    await ctx.storage.insertInstance(
      makeInstance({
        assigneeId: alice.id,
        assignmentKind: 'auto',
        occurrenceDate: '2026-07-20',
        dueDate: '2026-07-22',
        ...completedOn(alice.id, '2026-07-20'),
      }),
    );

    const badges = createBadgeService(ctx.storage);
    const result = await badges.rolloverIfNewWeek();

    expect(result).toEqual({ initialised: true, awardedWeekStart: null, awarded: 0 });
    expect(await ctx.storage.getBadgeState()).toEqual({
      lastAwardedWeekStart: '2026-07-20',
      badgesEpoch: '2026-07-20',
    });
    expect(await ctx.storage.listBadgeAwards()).toEqual([]);
    // …and the live earned view shows it pending (fluid, not yet awarded).
    const view = await badges.badgesForUser(alice.id);
    expect(view.awarded).toEqual([]);
    expect(view.earned.map((b) => b.badgeId)).toContain('amazing-worker-bronze');
  });

  it('awards the finished week\'s badges at the Monday rollover, with values', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    const badges = createBadgeService(ctx.storage);
    await badges.rolloverIfNewWeek(); // init at W0

    // W0: one in-window completion + two early completions.
    await ctx.storage.insertInstance(cleanJob(ctx, 0));
    for (const day of ['2026-07-20', '2026-07-21']) {
      await ctx.storage.insertInstance(
        makeInstance({
          assigneeId: alice.id,
          assignmentKind: 'auto',
          occurrenceDate: '2026-07-23',
          dueDate: '2026-07-24',
          ...completedOn(alice.id, day),
        }),
      );
    }

    monday(1);
    const result = await badges.rolloverIfNewWeek();
    expect(result).toEqual({ initialised: false, awardedWeekStart: '2026-07-20', awarded: 2 });

    const awards = (await ctx.storage.listBadgeAwards()).filter((a) => a.userId === alice.id);
    expect(awards.map((a) => a.badgeId).sort()).toEqual(['amazing-worker-bronze', 'eager-bunny-gold']);
    const eager = awards.find((a) => a.badgeId === 'eager-bunny-gold')!;
    expect(eager.value).toBe(2); // count badge carries the count
    expect(eager.weekStart).toBe('2026-07-20');
    expect(eager.kind).toBe('badge-award');
    expect(eager.awardedAt).toBeTruthy();
    const amazing = awards.find((a) => a.badgeId === 'amazing-worker-bronze')!;
    expect(amazing.value).toBeNull(); // plain badge
  });

  it('is idempotent within a week', async () => {
    ctx = await makeTestContext('2026-07-20');
    const badges = createBadgeService(ctx.storage);
    await badges.rolloverIfNewWeek();
    await ctx.storage.insertInstance(cleanJob(ctx, 0));

    monday(1);
    expect((await badges.rolloverIfNewWeek()).awarded).toBe(1);
    expect((await badges.rolloverIfNewWeek()).awarded).toBe(0); // same Monday → no-op
    monday(1, '18:30');
    expect((await badges.rolloverIfNewWeek()).awarded).toBe(0); // later that Monday → still no-op
    expect(await ctx.storage.listBadgeAwards()).toHaveLength(1);
  });

  it('handles multi-week clock jumps with a single pass for the latest completed week (Q9)', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    const badges = createBadgeService(ctx.storage);
    await badges.rolloverIfNewWeek(); // init at W0

    // Qualifying completions in W0, W1 and W2.
    await ctx.storage.insertInstance(cleanJob(ctx, 0));
    await ctx.storage.insertInstance(cleanJob(ctx, 1));
    await ctx.storage.insertInstance(cleanJob(ctx, 2));

    monday(3); // jump straight to W3 Monday
    const result = await badges.rolloverIfNewWeek();
    expect(result.awardedWeekStart).toBe('2026-08-03'); // W2 only

    const awards = (await ctx.storage.listBadgeAwards()).filter((a) => a.userId === alice.id);
    expect(new Set(awards.map((a) => a.weekStart))).toEqual(new Set(['2026-08-03']));
    // W0/W1 are skipped entirely — no awards are back-filled for them.
    expect(await ctx.storage.getBadgeState()).toMatchObject({ lastAwardedWeekStart: '2026-08-10' });
  });

  it('awards are permanent: reopening the job later does not remove them (D1/Q5)', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    const badges = createBadgeService(ctx.storage);
    await badges.rolloverIfNewWeek();

    const job = cleanJob(ctx, 0);
    await ctx.storage.insertInstance(job);
    monday(1);
    await badges.rolloverIfNewWeek();
    expect((await ctx.storage.listBadgeAwards()).map((a) => a.badgeId)).toContain('amazing-worker-bronze');

    // Reopen the underlying job: the award stays, but the live earned view downgrades.
    await ctx.storage.updateInstance(job.id, { status: 'pending', completedBy: null, completedAt: null, pointsAwarded: null });
    expect((await ctx.storage.listBadgeAwards()).map((a) => a.badgeId)).toContain('amazing-worker-bronze');
    const view = await badges.badgesForUser(alice.id);
    expect(view.awarded.map((a) => a.badgeId)).toContain('amazing-worker-bronze');
    expect(view.earned.map((b) => b.badgeId)).not.toContain('amazing-worker-bronze');
  });

  it('badgesForUser triggers the rollover lazily (no scheduler needed)', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    const badges = createBadgeService(ctx.storage);
    await badges.rolloverIfNewWeek();
    await ctx.storage.insertInstance(cleanJob(ctx, 0));

    monday(1);
    const view = await badges.badgesForUser(alice.id); // no explicit rollover call
    expect(view.awarded.map((a) => a.badgeId)).toContain('amazing-worker-bronze');
    expect(view.awarded[0]).toMatchObject({
      weekStart: '2026-07-20',
      badge: { tier: 'bronze', categoryId: 'amazing-worker' },
    });
  });

  it('404s badgesForUser for an unknown user', async () => {
    ctx = await makeTestContext('2026-07-20');
    const badges = createBadgeService(ctx.storage);
    await expect(badges.badgesForUser('ghost')).rejects.toMatchObject({ status: 404 });
  });

  it('persists awards and rollover state across storage reloads', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'taskmanager-badges-'));
    try {
      setSpoofedDate('2026-07-20T09:00:00');
      const storage = await JsonFileStorage.create(dir);
      const [alice] = [await createUserService(storage).create({ name: 'Alice' })];
      const badges = createBadgeService(storage);
      await badges.rolloverIfNewWeek();
      await storage.insertInstance(
        makeInstance({
          assigneeId: alice.id,
          assignmentKind: 'auto',
          occurrenceDate: '2026-07-20',
          dueDate: '2026-07-22',
          ...completedOn(alice.id, '2026-07-22'),
        }),
      );
      setSpoofedDate('2026-07-27T09:00:00');
      await badges.rolloverIfNewWeek();

      const reloaded = await JsonFileStorage.create(dir);
      expect(await reloaded.getBadgeState()).toEqual({
        lastAwardedWeekStart: '2026-07-27',
        badgesEpoch: '2026-07-20',
      });
      expect((await reloaded.listBadgeAwards()).map((a) => a.badgeId)).toContain('amazing-worker-bronze');
    } finally {
      setSpoofedDate(null);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('badgeService — streaks across multiple weekly rollovers', () => {
  it('grows the Amazing worker streak week over week, then loses it to a late job', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    const badges = createBadgeService(ctx.storage);
    await badges.rolloverIfNewWeek(); // epoch = W0

    // All jobs inserted upfront; completions dated after an as-of date are
    // excluded, so each rollover sees only its own week's data.
    for (const week of [0, 1, 2, 3]) await ctx.storage.insertInstance(cleanJob(ctx, week));
    // W4 goes wrong: completed two days late.
    await ctx.storage.insertInstance(
      makeInstance({
        assigneeId: alice.id,
        assignmentKind: 'auto',
        occurrenceDate: '2026-08-17',
        dueDate: '2026-08-19',
        ...completedOn(alice.id, '2026-08-21'),
      }),
    );

    const awardedByWeek = async () => {
      const awards = (await ctx!.storage.listBadgeAwards()).filter((a) => a.userId === alice.id);
      return new Map(awards.map((a) => [`${a.weekStart}:${a.badgeId}`, a.value]));
    };

    monday(1);
    await badges.rolloverIfNewWeek();
    let awards = await awardedByWeek();
    expect(awards.has('2026-07-20:amazing-worker-bronze')).toBe(true);
    expect(awards.has('2026-07-20:streak-amazing-bronze')).toBe(false); // streak 1 → nothing yet

    monday(2);
    await badges.rolloverIfNewWeek();
    awards = await awardedByWeek();
    expect(awards.has('2026-07-27:amazing-worker-bronze')).toBe(true);
    expect(awards.get('2026-07-27:streak-amazing-bronze')).toBe(2);

    monday(3);
    await badges.rolloverIfNewWeek();
    awards = await awardedByWeek();
    expect(awards.get('2026-08-03:streak-amazing-silver')).toBe(3);

    monday(4);
    await badges.rolloverIfNewWeek();
    awards = await awardedByWeek();
    expect(awards.get('2026-08-10:streak-amazing-gold')).toBe(4);

    // W4's late job breaks the clean streak: no streak award for W4, but the
    // late completion itself earns Back on track.
    monday(5);
    await badges.rolloverIfNewWeek();
    awards = await awardedByWeek();
    const w4 = [...awards.keys()].filter((k) => k.startsWith('2026-08-17:'));
    expect(w4).toEqual(['2026-08-17:back-on-track-silver']);
    expect(awards.get('2026-08-17:back-on-track-silver')).toBe(1);
  });

  it('awards the Eager streak (suppressing the Amazing streak) across all-early weeks', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    const badges = createBadgeService(ctx.storage);
    await badges.rolloverIfNewWeek(); // epoch = W0

    // Two weeks where every auto-assigned job is completed before its start date.
    for (const [week, mon] of [
      [0, '2026-07-20'],
      [1, '2026-07-27'],
    ] as const) {
      const [y, m, d] = W[week].split('-').map(Number);
      const at = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
      await ctx.storage.insertInstance(
        makeInstance({
          assigneeId: alice.id,
          assignmentKind: 'auto',
          occurrenceDate: at(2),
          dueDate: at(4),
          ...completedOn(alice.id, mon),
        }),
      );
    }

    monday(1);
    await badges.rolloverIfNewWeek(); // W0: eager-bunny count badge, streak 1
    monday(2);
    await badges.rolloverIfNewWeek(); // W1: streak-eager-bronze

    const awards = (await ctx.storage.listBadgeAwards()).filter((a) => a.userId === alice.id && a.weekStart === '2026-07-27');
    const ids = awards.map((a) => a.badgeId);
    expect(ids).toContain('streak-eager-bronze');
    expect(ids).not.toContain('streak-amazing-bronze'); // suppressed by the eager line (Q2)
    expect(awards.find((a) => a.badgeId === 'streak-eager-bronze')?.value).toBe(2);
    expect(ids).toContain('eager-bunny-gold'); // the week's early completion also counts
  });
});
