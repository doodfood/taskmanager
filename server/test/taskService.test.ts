import { afterEach, describe, expect, it } from 'vitest';
import { setSpoofedDate } from '../src/clock.js';
import { hydrateAll } from '../src/services/hydrationService.js';
import { createTaskService } from '../src/services/taskService.js';
import { HttpError } from '../src/types.js';
import type { TestContext } from './helpers.js';
import { makeTestContext } from './helpers.js';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

describe('taskService — definitions', () => {
  it('creates a one-off task with its instance immediately, due today + offset', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);

    const def = await tasks.createDefinition({
      title: 'Fix the gate',
      recurrence: 'none',
      autoAssignableTo: [ctx.users[0].id], // sole candidate → always assigned to them
      dueOffsetDays: 3,
    });
    expect(def.recurrence).toBe('none');

    const instances = await ctx.storage.listInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].occurrenceDate).toBe('2026-07-20');
    expect(instances[0].dueDate).toBe('2026-07-23');
    expect(instances[0].assigneeId).toBe(ctx.users[0].id);
  });

  it('creates a one-off on a future startDate instead of today', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);

    const def = await tasks.createDefinition({
      title: 'Future fix',
      recurrence: 'none',
      startDate: '2026-08-01',
      dueOffsetDays: 2,
    });
    expect(def.startDate).toBe('2026-08-01');
    expect(def.lastHydratedDate).toBe('2026-08-01');

    const instances = await ctx.storage.listInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].occurrenceDate).toBe('2026-08-01');
    expect(instances[0].dueDate).toBe('2026-08-03');
  });

  it('defaults startDate to null (anchor on creation date) when omitted', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);

    const def = await tasks.createDefinition({ title: 'Plain', recurrence: 'none' });
    expect(def.startDate).toBeNull();
    const [instance] = await ctx.storage.listInstances();
    expect(instance.occurrenceDate).toBe('2026-07-20');
  });

  it('rejects an invalid startDate', async () => {
    ctx = await makeTestContext();
    const tasks = createTaskService(ctx.storage);

    await expect(tasks.createDefinition({ title: 'x', startDate: 'tomorrow' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', startDate: '2026-02-30' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', startDate: '2026-7-1' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', startDate: 12345 })).rejects.toThrow(HttpError);
  });

  it('PATCH accepts startDate, but the hydration watermark keeps driving the series', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const def = await tasks.createDefinition({ title: 'Weekly', recurrence: 'weekly-1' });
    expect((await ctx.storage.listInstances()).map((i) => i.occurrenceDate)).toEqual(['2026-07-20']);

    // Moving startDate after hydration has begun must not move the series —
    // lastHydratedDate (2026-07-20) wins, so the next occurrence is 07-27,
    // not 08-01 (the patched startDate).
    const updated = await tasks.updateDefinition(def.id, { startDate: '2026-08-01' });
    expect(updated.startDate).toBe('2026-08-01');

    setSpoofedDate('2026-07-27T09:00:00');
    await hydrateAll(ctx.storage, 1);
    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate).sort();
    expect(dates).toEqual(['2026-07-20', '2026-07-27']);

    // …and the same validation rules apply on PATCH.
    await expect(tasks.updateDefinition(def.id, { startDate: 'not-a-date' })).rejects.toThrow(HttpError);
  });

  it('rejects invalid input', async () => {
    ctx = await makeTestContext();
    const tasks = createTaskService(ctx.storage);

    await expect(tasks.createDefinition({ recurrence: 'weekly-1' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', recurrence: 'fortnightly' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', recurrence: 'weekly' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', recurrence: 'weekly-14' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', dueOffsetDays: -1 })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', autoAssignableTo: ['no-such-user'] })).rejects.toThrow(HttpError);
  });

  it('creates instances for "anyone" when the definition has no auto-assign candidates', async () => {
    ctx = await makeTestContext();
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Shared chore', recurrence: 'weekly-1' });
    const [instance] = await ctx.storage.listInstances();
    expect(instance.assigneeId).toBeNull();
  });

  it('deleting a definition removes its pending instances but keeps completed ones', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const def = await tasks.createDefinition({ title: 'Weekly', recurrence: 'weekly-1' });
    const [first] = await ctx.storage.listInstances();
    await tasks.complete(first.id, ctx.users[0].id);

    setSpoofedDate('2026-07-27T09:00:00');
    await hydrateAll(ctx.storage, 1);
    expect(await ctx.storage.listInstances()).toHaveLength(2); // 07-20 done, 07-27 pending

    await tasks.deleteDefinition(def.id);
    const remaining = await ctx.storage.listInstances();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe('completed');
  });
});

describe('taskService — instances', () => {
  it('completes a task, recording who and when', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'One-off', recurrence: 'none' });
    const [instance] = await ctx.storage.listInstances();

    const completed = await tasks.complete(instance.id, ctx.users[1].id);
    expect(completed.status).toBe('completed');
    expect(completed.completedBy).toBe(ctx.users[1].id);
    expect(completed.completedAt).toBe(new Date('2026-07-20T09:00:00').toISOString());
  });

  it('rejects completing twice and completing with an unknown user', async () => {
    ctx = await makeTestContext();
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'One-off', recurrence: 'none' });
    const [instance] = await ctx.storage.listInstances();

    await expect(tasks.complete(instance.id, 'ghost')).rejects.toThrow(HttpError);
    await tasks.complete(instance.id, ctx.users[0].id);
    await expect(tasks.complete(instance.id, ctx.users[0].id)).rejects.toThrow(/already completed/);
  });

  it('reopens a completed task', async () => {
    ctx = await makeTestContext();
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'One-off', recurrence: 'none' });
    const [instance] = await ctx.storage.listInstances();

    await tasks.complete(instance.id, ctx.users[0].id);
    const reopened = await tasks.reopen(instance.id);
    expect(reopened.status).toBe('pending');
    expect(reopened.completedBy).toBeNull();
    expect(reopened.completedAt).toBeNull();
  });

  it('reassigns a task to another user or back to anyone', async () => {
    ctx = await makeTestContext();
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'One-off', recurrence: 'none', autoAssignableTo: [ctx.users[0].id] });
    const [instance] = await ctx.storage.listInstances();

    expect((await tasks.reassign(instance.id, ctx.users[1].id)).assigneeId).toBe(ctx.users[1].id);
    expect((await tasks.reassign(instance.id, null)).assigneeId).toBeNull();
    await expect(tasks.reassign(instance.id, 'ghost')).rejects.toThrow(HttpError);
  });

  it('upcoming returns my pending tasks + anyone tasks within the window, overdue included', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    // Mine, due in 3 days.
    await tasks.createDefinition({ title: 'Mine', recurrence: 'none', autoAssignableTo: [alice.id], dueOffsetDays: 3 });
    // Anyone, due today.
    await tasks.createDefinition({ title: 'Shared', recurrence: 'none' });
    // Bob's — must not appear for Alice.
    await tasks.createDefinition({ title: 'Bobs', recurrence: 'none', autoAssignableTo: [bob.id], dueOffsetDays: 1 });
    // Overdue for Alice: created "yesterday" via clock rewind.
    setSpoofedDate('2026-07-19T09:00:00');
    await tasks.createDefinition({ title: 'Overdue', recurrence: 'none', autoAssignableTo: [alice.id], dueOffsetDays: 0 });
    setSpoofedDate('2026-07-20T09:00:00');

    const upcoming = await tasks.upcoming(alice.id, 7);
    expect(upcoming.map((i) => i.title)).toEqual(['Overdue', 'Shared', 'Mine']);

    const bobs = await tasks.upcoming(bob.id, 7);
    expect(bobs.map((i) => i.title)).toEqual(['Overdue' , 'Shared', 'Bobs'].filter((t) => t !== 'Overdue'));
    expect(bobs.map((i) => i.title)).toEqual(['Shared', 'Bobs']);
  });

  it('listInstances filters by status/assignee/dates', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice] = ctx.users;

    await tasks.createDefinition({ title: 'A', recurrence: 'none', autoAssignableTo: [alice.id], dueOffsetDays: 0 });
    await tasks.createDefinition({ title: 'B', recurrence: 'none', dueOffsetDays: 5 });

    const pending = await tasks.listInstances({ status: 'pending' });
    expect(pending).toHaveLength(2);

    const alices = await tasks.listInstances({ assigneeId: alice.id });
    expect(alices.map((i) => i.title)).toEqual(['A']);

    const alicesPlusAnyone = await tasks.listInstances({ assigneeId: alice.id, includeAnyone: true });
    expect(alicesPlusAnyone.map((i) => i.title)).toEqual(['A', 'B']);

    const ranged = await tasks.listInstances({ from: '2026-07-24', to: '2026-07-26' });
    expect(ranged.map((i) => i.title)).toEqual(['B']);
  });
});
