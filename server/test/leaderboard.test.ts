import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { setSpoofedDate } from '../src/clock.js';
import { createLeaderboardService } from '../src/services/leaderboardService.js';
import { createTaskService } from '../src/services/taskService.js';
import type { StorageProvider } from '../src/storage/StorageProvider.js';
import type { PointGrant, PointRevocation } from '../src/types.js';
import type { TestContext } from './helpers.js';
import { makeTestContext } from './helpers.js';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

let seq = 0;

/**
 * Insert a grant directly, with full control over the completion timestamp.
 * Timestamps are local-time ISO strings (no Z) so the local-date extraction
 * the leaderboard does is exact, whatever timezone the test runner is in.
 */
async function insertGrant(storage: StorageProvider, userId: string, completedAt: string, points = 10): Promise<PointGrant> {
  seq += 1;
  const grant: PointGrant = {
    id: `g${seq}`,
    kind: 'grant',
    userId,
    instanceId: `i${seq}`,
    definitionId: `d${seq}`,
    title: `Task ${seq}`,
    faceValue: points,
    points,
    timing: 'on-time',
    daysLate: 0,
    completedAt,
  };
  await storage.insertPointEvent(grant);
  return grant;
}

async function insertRevocation(storage: StorageProvider, grant: PointGrant): Promise<PointRevocation> {
  seq += 1;
  const revocation: PointRevocation = {
    id: `r${seq}`,
    kind: 'revocation',
    grantId: grant.id,
    userId: grant.userId,
    instanceId: grant.instanceId,
    points: grant.points,
    reopenedAt: '2026-07-20T10:00:00',
  };
  await storage.insertPointEvent(revocation);
  return revocation;
}

describe('leaderboard — ranking', () => {
  it('ranks by net points descending, ties broken alphabetically by name', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice, bob] = ctx.users;
    const charlie = await ctx.storage.insertUser({ id: 'u-charlie', name: 'Charlie', color: '#000', createdAt: '2026-07-01T00:00:00' });

    await insertGrant(ctx.storage, alice.id, '2026-07-20T08:00:00', 10);
    await insertGrant(ctx.storage, bob.id, '2026-07-19T08:00:00', 25);
    await insertGrant(ctx.storage, charlie.id, '2026-07-18T08:00:00', 10);

    const board = await createLeaderboardService(ctx.storage).leaderboard(1);
    expect(board.map((e) => e.user.name)).toEqual(['Bob', 'Alice', 'Charlie']);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(board[0]).toMatchObject({ totalPoints: 25, tasksCompleted: 1 });
  });

  it('includes every registered user, even with 0 points in the window', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice, bob] = ctx.users;

    await insertGrant(ctx.storage, bob.id, '2026-07-20T08:00:00', 7);

    const board = await createLeaderboardService(ctx.storage).leaderboard(1);
    expect(board).toHaveLength(2);
    expect(board[0]).toMatchObject({ user: { id: bob.id }, totalPoints: 7, tasksCompleted: 1, rank: 1 });
    expect(board[1]).toMatchObject({ user: { id: alice.id }, totalPoints: 0, tasksCompleted: 0, rank: 2 });
  });

  it('drops deleted users off the board but keeps their history harmless', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;

    await insertGrant(ctx.storage, 'u-ghost', '2026-07-20T08:00:00', 99); // not a registered user
    await insertGrant(ctx.storage, alice.id, '2026-07-20T09:00:00', 5);

    const board = await createLeaderboardService(ctx.storage).leaderboard(1);
    expect(board.map((e) => e.user.id)).not.toContain('u-ghost');
    expect(board.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 5, rank: 1 });
  });
});

describe('leaderboard — revocations', () => {
  it('excludes revoked grants from points and the tasks-completed tally', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice, bob] = ctx.users;

    const revoked = await insertGrant(ctx.storage, alice.id, '2026-07-20T08:00:00', 15);
    await insertRevocation(ctx.storage, revoked);
    await insertGrant(ctx.storage, alice.id, '2026-07-20T09:00:00', 5);
    await insertGrant(ctx.storage, bob.id, '2026-07-20T10:00:00', 8);

    const board = await createLeaderboardService(ctx.storage).leaderboard(1);
    expect(board.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 5, tasksCompleted: 1 });
    expect(board.find((e) => e.user.id === bob.id)).toMatchObject({ totalPoints: 8, tasksCompleted: 1 });
  });
});

describe('leaderboard — rolling window', () => {
  it('counts only grants inside the window', async () => {
    ctx = await makeTestContext('2026-07-20'); // 1-week window: 07-14 … 07-20
    const [alice] = ctx.users;

    await insertGrant(ctx.storage, alice.id, '2026-07-14T08:00:00', 4); // oldest in-window day
    await insertGrant(ctx.storage, alice.id, '2026-07-10T08:00:00', 30); // outside

    const board = await createLeaderboardService(ctx.storage).leaderboard(1);
    expect(board.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 4, tasksCompleted: 1 });
  });

  it('excludes an entry exactly N weeks ago; includes one N·7−1 days ago', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;

    await insertGrant(ctx.storage, alice.id, '2026-07-13T23:00:00', 50); // exactly 1 week ago → out for weeks=1
    await insertGrant(ctx.storage, alice.id, '2026-07-14T00:00:00', 6); // 6 days ago → in

    const service = createLeaderboardService(ctx.storage);
    const oneWeek = await service.leaderboard(1);
    expect(oneWeek.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 6, tasksCompleted: 1 });

    // …but both fall inside the 2-week window (07-07 … 07-20).
    const twoWeeks = await service.leaderboard(2);
    expect(twoWeeks.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 56, tasksCompleted: 2 });
  });

  it('measures the window back from the central (spoofable) clock', async () => {
    ctx = await makeTestContext('2026-07-20');
    const [alice] = ctx.users;
    await insertGrant(ctx.storage, alice.id, '2026-07-14T08:00:00', 9);

    const service = createLeaderboardService(ctx.storage);
    expect((await service.leaderboard(1)).find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 9 });

    setSpoofedDate('2026-07-21T09:00:00'); // window shifts to 07-15 … 07-21
    expect((await service.leaderboard(1)).find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 0 });
  });

  it('rejects week counts outside 1/2/4/8', async () => {
    ctx = await makeTestContext('2026-07-20');
    const service = createLeaderboardService(ctx.storage);
    for (const weeks of [0, 3, 5, 8.5, -1, Number.NaN]) {
      await expect(service.leaderboard(weeks)).rejects.toMatchObject({ status: 400 });
    }
    await expect(service.leaderboard(8)).resolves.toHaveLength(2); // sanity: 8 is valid
  });
});

describe('leaderboard — task lifecycle integration', () => {
  it('reflects complete → reopen → re-complete through the task service', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const service = createLeaderboardService(ctx.storage);
    const [alice, bob] = ctx.users;

    await tasks.createDefinition({ title: 'Bins', recurrence: 'none', points: 10, dueOffsetDays: 0 });
    const [instance] = await ctx.storage.listInstances();

    // Alice completes on time → Alice +10, 1 task.
    await tasks.complete(instance.id, alice.id);
    let board = await service.leaderboard(1);
    expect(board.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 10, tasksCompleted: 1 });

    // Reopen → the completion counts for nothing, anywhere.
    await tasks.reopen(instance.id);
    board = await service.leaderboard(1);
    expect(board.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 0, tasksCompleted: 0 });

    // Bob re-completes 3 days late → fresh award to the new completer.
    setSpoofedDate('2026-07-23T09:00:00');
    await tasks.complete(instance.id, bob.id);
    board = await service.leaderboard(1);
    expect(board.find((e) => e.user.id === alice.id)).toMatchObject({ totalPoints: 0, tasksCompleted: 0 });
    expect(board.find((e) => e.user.id === bob.id)).toMatchObject({ totalPoints: 7, tasksCompleted: 1 });
  });
});

describe('leaderboard — HTTP endpoint', () => {
  it('GET /api/leaderboard?weeks=1 returns ranked entries after a completion', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    const [alice, bob] = ctx.users;

    const def = await request(app).post('/api/task-definitions').send({ title: 'Mow lawn', recurrence: 'none', points: 10 });
    expect(def.status).toBe(201);
    const instances = await request(app).get('/api/task-instances');
    await request(app).post(`/api/task-instances/${instances.body[0].id}/complete`).send({ completedBy: alice.id });

    const res = await request(app).get('/api/leaderboard?weeks=1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      user: { id: alice.id, name: 'Alice' },
      totalPoints: 10, // due today (dueOffsetDays defaults to 0) → on-time face value
      tasksCompleted: 1,
      rank: 1,
    });
    expect(res.body[1]).toMatchObject({ user: { id: bob.id }, totalPoints: 0, tasksCompleted: 0, rank: 2 });
  });

  it('defaults to the 1-week window when weeks is omitted', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('rejects invalid weeks values with 400', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    for (const weeks of ['0', '3', 'abc', '8.5', '']) {
      const res = await request(app).get(`/api/leaderboard?weeks=${weeks}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    for (const weeks of ['1', '2', '4', '8']) {
      const res = await request(app).get(`/api/leaderboard?weeks=${weeks}`);
      expect(res.status).toBe(200);
    }
  });
});
