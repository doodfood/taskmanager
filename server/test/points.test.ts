import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setSpoofedDate } from '../src/clock.js';
import { createPointsService } from '../src/services/pointsService.js';
import { createTaskService } from '../src/services/taskService.js';
import { JsonFileStorage } from '../src/storage/JsonFileStorage.js';
import type { PointGrant, PointRevocation } from '../src/types.js';
import type { TestContext } from './helpers.js';
import { makeTestContext } from './helpers.js';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

function grantsOf(events: { kind: string }[]): PointGrant[] {
  return events.filter((e): e is PointGrant => e.kind === 'grant');
}

function revocationsOf(events: { kind: string }[]): PointRevocation[] {
  return events.filter((e): e is PointRevocation => e.kind === 'revocation');
}

/** Net points per user from the raw ledger (grants minus their revocations). */
function netPoints(events: (PointGrant | PointRevocation)[]): Map<string, number> {
  const revokedIds = new Set(revocationsOf(events).map((r) => r.grantId));
  const net = new Map<string, number>();
  for (const g of grantsOf(events)) {
    if (revokedIds.has(g.id)) continue;
    net.set(g.userId, (net.get(g.userId) ?? 0) + g.points);
  }
  return net;
}

describe('points — grants on completion', () => {
  it('grants the early bonus when completed before the due date', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'Bins', recurrence: 'none', points: 20, dueOffsetDays: 3 });
    const [instance] = await ctx.storage.listInstances();
    expect(instance.dueDate).toBe('2026-07-23');

    const completed = await tasks.complete(instance.id, alice.id);
    expect(completed.pointsAwarded).toBe(25); // 20 + 5 early bonus

    const events = await ctx.storage.listPointEvents();
    expect(events).toHaveLength(1);
    const [grant] = grantsOf(events);
    expect(grant).toMatchObject({
      kind: 'grant',
      userId: alice.id,
      instanceId: instance.id,
      definitionId: completed.definitionId,
      title: 'Bins',
      faceValue: 20,
      points: 25,
      timing: 'early',
      daysLate: 0,
    });
    // The instance mirrors the exact ledger timestamp and award.
    expect(completed.completedAt).toBe(grant.completedAt);
  });

  it('grants the face value when completed on the due date', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'Bins', recurrence: 'none', points: 10, dueOffsetDays: 0 });
    const [instance] = await ctx.storage.listInstances();

    const completed = await tasks.complete(instance.id, alice.id);
    expect(completed.pointsAwarded).toBe(10);
    const [grant] = grantsOf(await ctx.storage.listPointEvents());
    expect(grant).toMatchObject({ points: 10, timing: 'on-time', daysLate: 0 });
  });

  it('grants face value −1 per day late, floored at 1', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'Bins', recurrence: 'none', points: 10, dueOffsetDays: 0 });
    const [instance] = await ctx.storage.listInstances();

    setSpoofedDate('2026-07-23T09:00:00'); // 3 days late
    const completed = await tasks.complete(instance.id, alice.id);
    expect(completed.pointsAwarded).toBe(7);
    const [grant] = grantsOf(await ctx.storage.listPointEvents());
    expect(grant).toMatchObject({ points: 7, timing: 'late', daysLate: 3 });
  });

  it('grants the 1-point floor for a 0-point task', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'Freebie', recurrence: 'none', points: 0 });
    const [instance] = await ctx.storage.listInstances();

    const completed = await tasks.complete(instance.id, alice.id);
    expect(completed.pointsAwarded).toBe(1);
  });

  it('grants to the completer, not the assignee', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    await tasks.createDefinition({
      title: 'Alices task',
      recurrence: 'none',
      points: 10,
      autoAssignableTo: [alice.id],
    });
    const [instance] = await ctx.storage.listInstances();
    expect(instance.assigneeId).toBe(alice.id);

    await tasks.complete(instance.id, bob.id); // Bob does Alice's task
    const [grant] = grantsOf(await ctx.storage.listPointEvents());
    expect(grant.userId).toBe(bob.id);
  });
});

describe('points — reopen and re-completion', () => {
  it('reopen revokes the exact grant from the user who completed it', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const points = createPointsService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'Bins', recurrence: 'none', points: 10 });
    const [instance] = await ctx.storage.listInstances();
    await tasks.complete(instance.id, alice.id);
    const [grant] = grantsOf(await ctx.storage.listPointEvents());

    const reopened = await tasks.reopen(instance.id);
    expect(reopened.pointsAwarded).toBeNull();

    const events = await ctx.storage.listPointEvents();
    expect(events).toHaveLength(2);
    const [revocation] = revocationsOf(events);
    expect(revocation).toMatchObject({
      kind: 'revocation',
      grantId: grant.id,
      userId: alice.id,
      instanceId: instance.id,
      points: grant.points,
    });
    // Grant + revocation cancel out: nothing active, net zero.
    expect(await points.activeGrants()).toEqual([]);
    expect(netPoints(events).size).toBe(0);
  });

  it('supports reopen → reassign → re-complete (the plan key scenario)', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    await tasks.createDefinition({ title: 'Bins', recurrence: 'none', points: 10, dueOffsetDays: 0 });
    const [instance] = await ctx.storage.listInstances();

    // 1. Alice completes on time → Alice +10.
    await tasks.complete(instance.id, alice.id);
    // 2. Reopen → Alice −10 (net 0 for that completion).
    await tasks.reopen(instance.id);
    // 3. Reassign to Bob.
    await tasks.reassign(instance.id, bob.id);
    // 4. Bob completes, now 2 days overdue → Bob +8.
    setSpoofedDate('2026-07-22T09:00:00');
    const recompleted = await tasks.complete(instance.id, bob.id);
    expect(recompleted.pointsAwarded).toBe(8);

    // Final standing: Alice 0, Bob 8 — points track the completion that stuck.
    const events = await ctx.storage.listPointEvents();
    expect(events).toHaveLength(3); // grant, revocation, grant
    const net = netPoints(events);
    expect(net.get(alice.id) ?? 0).toBe(0);
    expect(net.get(bob.id)).toBe(8);
  });

  it('re-completing after reopen recomputes the award from the new date', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'Bins', recurrence: 'none', points: 10, dueOffsetDays: 0 });
    const [instance] = await ctx.storage.listInstances();

    await tasks.complete(instance.id, alice.id); // on time → 10
    await tasks.reopen(instance.id);

    setSpoofedDate('2026-07-25T09:00:00'); // 5 days late now
    const recompleted = await tasks.complete(instance.id, alice.id);
    expect(recompleted.pointsAwarded).toBe(5); // 10 − 5

    const events = await ctx.storage.listPointEvents();
    const net = netPoints(events);
    expect(net.get(alice.id)).toBe(5); // the on-time 10 was revoked; only the 5 counts
  });

  it('reopening a pre-gamification completion records no revocation', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'Old task', recurrence: 'none', points: 10 });
    const [instance] = await ctx.storage.listInstances();
    // Simulate a completion from before the ledger existed: completed state
    // written directly, with no grant entry behind it.
    await ctx.storage.updateInstance(instance.id, {
      status: 'completed',
      completedBy: alice.id,
      completedAt: '2026-07-19T10:00:00.000Z',
    });

    const reopened = await tasks.reopen(instance.id);
    expect(reopened.status).toBe('pending');
    expect(await ctx.storage.listPointEvents()).toEqual([]);
  });
});

describe('points — ledger persistence', () => {
  it('round-trips the ledger through point-events.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'taskmanager-points-'));
    try {
      const first = await JsonFileStorage.create(dir);
      await first.insertPointEvent({
        id: 'g1',
        kind: 'grant',
        userId: 'u1',
        instanceId: 'i1',
        definitionId: 'd1',
        title: 'Bins',
        faceValue: 10,
        points: 15,
        timing: 'early',
        daysLate: 0,
        completedAt: '2026-07-20T09:00:00.000Z',
      });
      await first.insertPointEvent({
        id: 'r1',
        kind: 'revocation',
        grantId: 'g1',
        userId: 'u1',
        instanceId: 'i1',
        points: 15,
        reopenedAt: '2026-07-21T09:00:00.000Z',
      });

      // A fresh storage instance over the same directory sees both entries,
      // and a missing ledger file starts empty.
      const second = await JsonFileStorage.create(dir);
      expect(await second.listPointEvents()).toHaveLength(2);
      const empty = await JsonFileStorage.create(await mkdtemp(path.join(tmpdir(), 'taskmanager-points-')));
      expect(await empty.listPointEvents()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
