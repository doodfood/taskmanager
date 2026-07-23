import { afterEach, describe, expect, it } from 'vitest';
import { setSpoofedDate } from '../src/clock.js';
import { hydrateAll } from '../src/services/hydrationService.js';
import { createTaskService } from '../src/services/taskService.js';
import { createUserService } from '../src/services/userService.js';
import { HttpError, type TaskDefinition } from '../src/types.js';
import type { TestContext } from './helpers.js';
import { makeTestContext } from './helpers.js';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

describe('auto-assignment', () => {
  it('assigns a one-off instance to the candidate with the fewest outstanding points', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    // Alice already carries 5 outstanding points from an unrelated task.
    await tasks.createDefinition({ title: 'Alice load', recurrence: 'none', assigneeId: alice.id, points: 5 });

    await tasks.createDefinition({
      title: 'Shared chore',
      recurrence: 'none',
      points: 3,
      autoAssignableTo: [alice.id, bob.id],
    });

    const shared = (await ctx.storage.listInstances()).find((i) => i.title === 'Shared chore');
    expect(shared?.assigneeId).toBe(bob.id);
    expect(shared?.points).toBe(3);
  });

  it('breaks ties by autoAssignableTo order', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    await tasks.createDefinition({ title: 'AB', recurrence: 'none', autoAssignableTo: [alice.id, bob.id] });
    await tasks.createDefinition({ title: 'BA', recurrence: 'none', autoAssignableTo: [bob.id, alice.id] });

    const instances = await ctx.storage.listInstances();
    expect(instances.find((i) => i.title === 'AB')?.assigneeId).toBe(alice.id);
    // NB: the AB instance counts 1 point against Alice by the time BA is created,
    // so Bob would win even without the order tiebreak.
    expect(instances.find((i) => i.title === 'BA')?.assigneeId).toBe(bob.id);
  });

  it('does not count completed tasks towards the load', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    await tasks.createDefinition({ title: 'Alice done', recurrence: 'none', assigneeId: alice.id, points: 5 });
    const done = (await ctx.storage.listInstances()).find((i) => i.title === 'Alice done');
    await tasks.complete(done!.id, alice.id);

    await tasks.createDefinition({ title: 'Shared', recurrence: 'none', autoAssignableTo: [alice.id, bob.id] });
    const shared = (await ctx.storage.listInstances()).find((i) => i.title === 'Shared');
    // 0–0 tie → first candidate wins.
    expect(shared?.assigneeId).toBe(alice.id);
  });

  it('ignores occurrences still in the future', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    // Alice's 5-point task hasn't arrived yet (occurrenceDate tomorrow) → no load.
    await tasks.createDefinition({
      title: 'Alice future',
      recurrence: 'none',
      assigneeId: alice.id,
      points: 5,
      startDate: '2026-07-21',
    });

    await tasks.createDefinition({ title: 'Shared', recurrence: 'none', autoAssignableTo: [alice.id, bob.id] });
    const shared = (await ctx.storage.listInstances()).find((i) => i.title === 'Shared');
    expect(shared?.assigneeId).toBe(alice.id); // 0–0 tie → first candidate
  });

  it('only counts tasks assigned to the candidates themselves', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const users = createUserService(ctx.storage);
    const [alice, bob] = ctx.users;
    const carol = await users.create({ name: 'Carol' });

    // Carol is drowning in work but isn't a candidate — she must not skew the balance.
    await tasks.createDefinition({ title: 'Carol load', recurrence: 'none', assigneeId: carol.id, points: 100 });

    await tasks.createDefinition({ title: 'Shared', recurrence: 'none', autoAssignableTo: [alice.id, bob.id] });
    const shared = (await ctx.storage.listInstances()).find((i) => i.title === 'Shared');
    expect(shared?.assigneeId).toBe(alice.id); // 0–0 tie → first candidate
  });

  it('balances recurring occurrences across candidates as the clock advances', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    await tasks.createDefinition({
      title: 'Bins',
      recurrence: 'weekly-1',
      points: 2,
      autoAssignableTo: [alice.id, bob.id],
    });

    // Creation-time occurrence: 0–0 tie → Alice.
    const assignees = (await ctx.storage.listInstances()).map((i) => i.assigneeId);
    expect(assignees).toEqual([alice.id]);

    setSpoofedDate('2026-07-27T09:00:00');
    await hydrateAll(ctx.storage, 1);
    // Alice now has 2 outstanding → Bob gets the new occurrence.
    setSpoofedDate('2026-08-03T09:00:00');
    await hydrateAll(ctx.storage, 1);

    const byOccurrence = (await ctx.storage.listInstances()).sort((a, b) =>
      a.occurrenceDate.localeCompare(b.occurrenceDate),
    );
    expect(byOccurrence.map((i) => i.occurrenceDate)).toEqual(['2026-07-20', '2026-07-27', '2026-08-03']);
    // 07-27 → Bob (Alice had 2); 08-03 → Alice (2–2 tie, first candidate).
    expect(byOccurrence.map((i) => i.assigneeId)).toEqual([alice.id, bob.id, alice.id]);
  });

  it('falls back to assigneeId when the definition has no auto-assign candidates', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;

    // Bob is less busy, but the definition names no candidates → keeps its assignee.
    await tasks.createDefinition({ title: 'Bob load', recurrence: 'none', assigneeId: bob.id, points: 0 });
    await tasks.createDefinition({ title: 'Fixed', recurrence: 'none', assigneeId: alice.id });

    const fixed = (await ctx.storage.listInstances()).find((i) => i.title === 'Fixed');
    expect(fixed?.assigneeId).toBe(alice.id);
  });

  it('snapshots points onto the instance at hydration time', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);

    const def = await tasks.createDefinition({ title: 'Heavy', recurrence: 'none', points: 7 });
    const [instance] = await ctx.storage.listInstances();
    expect(instance.points).toBe(7);

    // Editing the template afterwards does not touch already-hydrated instances.
    await tasks.updateDefinition(def.id, { points: 1 });
    expect((await ctx.storage.getInstance(instance.id))?.points).toBe(7);
  });

  it('back-compat: hydrates a legacy definition without points/autoAssignableTo fields', async () => {
    ctx = await makeTestContext('2026-07-20');
    // Simulate a pre-existing JSON record — both fields absent entirely.
    const legacy = {
      id: 'legacy-def',
      title: 'Legacy',
      description: '',
      recurrence: 'weekly-1',
      assigneeId: null,
      dueOffsetDays: 0,
      active: true,
      lastHydratedDate: null,
      createdAt: '2026-07-20T09:00:00.000Z',
    } as TaskDefinition;
    await ctx.storage.insertDefinition(legacy);

    const result = await hydrateAll(ctx.storage, 1);
    expect(result.created).toBe(1);
    const [instance] = await ctx.storage.listInstances();
    expect(instance.assigneeId).toBeNull();
    expect(instance.points).toBe(1); // default difficulty
  });
});

describe('points and autoAssignableTo validation', () => {
  it('defaults points to 1 and autoAssignableTo to empty', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const def = await tasks.createDefinition({ title: 'Plain', recurrence: 'none' });
    expect(def.points).toBe(1);
    expect(def.autoAssignableTo).toEqual([]);
  });

  it('rejects invalid points values', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await expect(tasks.createDefinition({ title: 'x', points: -1 })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', points: 101 })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', points: 1.5 })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', points: 'lots' })).rejects.toThrow(HttpError);
  });

  it('accepts 0 points and coerces numeric strings', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    expect((await tasks.createDefinition({ title: 'Free', points: 0 })).points).toBe(0);
    expect((await tasks.createDefinition({ title: 'Stringy', points: '5' })).points).toBe(5);
  });

  it('rejects malformed autoAssignableTo and unknown users', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await expect(tasks.createDefinition({ title: 'x', autoAssignableTo: 'not-an-array' })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', autoAssignableTo: [123] })).rejects.toThrow(HttpError);
    await expect(tasks.createDefinition({ title: 'x', autoAssignableTo: ['ghost'] })).rejects.toThrow(HttpError);
  });

  it('dedupes autoAssignableTo preserving order', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;
    const def = await tasks.createDefinition({
      title: 'x',
      autoAssignableTo: [alice.id, alice.id, bob.id],
    });
    expect(def.autoAssignableTo).toEqual([alice.id, bob.id]);
  });

  it('updates points and autoAssignableTo via updateDefinition', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const [alice, bob] = ctx.users;
    const def = await tasks.createDefinition({ title: 'x', recurrence: 'none' });

    const updated = await tasks.updateDefinition(def.id, { points: 9, autoAssignableTo: [bob.id, alice.id] });
    expect(updated.points).toBe(9);
    expect(updated.autoAssignableTo).toEqual([bob.id, alice.id]);

    await expect(tasks.updateDefinition(def.id, { points: 1000 })).rejects.toThrow(HttpError);
    await expect(tasks.updateDefinition(def.id, { autoAssignableTo: ['ghost'] })).rejects.toThrow(HttpError);
  });
});
