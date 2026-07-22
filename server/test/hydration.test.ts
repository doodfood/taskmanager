import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { setSpoofedDate } from '../src/clock.js';
import { hydrateAll, stepDate } from '../src/services/hydrationService.js';
import { createTaskService } from '../src/services/taskService.js';
import type { TaskDefinition } from '../src/types.js';
import type { TestContext } from './helpers.js';
import { makeTestContext } from './helpers.js';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

describe('stepDate', () => {
  it('steps by each recurrence interval', () => {
    expect(stepDate('2026-07-20', 'daily')).toBe('2026-07-21');
    expect(stepDate('2026-07-20', 'weekly')).toBe('2026-07-27');
    expect(stepDate('2026-07-20', 'monthly')).toBe('2026-08-20');
    expect(stepDate('2026-07-20', 'quarterly')).toBe('2026-10-20');
  });

  it('handles month/year boundaries', () => {
    expect(stepDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(stepDate('2026-12-31', 'daily')).toBe('2027-01-01');
  });
});

describe('hydration', () => {
  it('creates occurrences for a daily task up to the horizon (today + 1)', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Water plants', recurrence: 'daily' });

    const result = await hydrateAll(ctx.storage, 1);
    expect(result.created).toBe(0); // creation already hydrated today + tomorrow

    const instances = await ctx.storage.listInstances();
    expect(instances.map((i) => i.occurrenceDate).sort()).toEqual(['2026-07-20', '2026-07-21']);
  });

  it('is idempotent — running repeatedly creates no duplicates', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Water plants', recurrence: 'daily' });

    await hydrateAll(ctx.storage, 1);
    await hydrateAll(ctx.storage, 1);
    const result = await hydrateAll(ctx.storage, 1);
    expect(result.created).toBe(0);
    expect(await ctx.storage.listInstances()).toHaveLength(2);
  });

  it('hydrates new occurrences as the (spoofed) clock advances', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Water plants', recurrence: 'daily' });

    setSpoofedDate('2026-07-23T09:00:00');
    const result = await hydrateAll(ctx.storage, 1);
    expect(result.created).toBe(3); // 07-22, 07-23 and 07-24 (07-20/07-21 created at definition time)

    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate).sort();
    expect(dates).toEqual(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
  });

  it('hydrates weekly occurrences 7 days apart', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Bins', recurrence: 'weekly' });

    setSpoofedDate('2026-08-05T09:00:00');
    await hydrateAll(ctx.storage, 1);

    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate).sort();
    expect(dates).toEqual(['2026-07-20', '2026-07-27', '2026-08-03']);
  });

  it('applies dueOffsetDays to the due date', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Vacuum', recurrence: 'daily', dueOffsetDays: 2 });

    const [instance] = await ctx.storage.listInstances();
    expect(instance.occurrenceDate).toBe('2026-07-20');
    expect(instance.dueDate).toBe('2026-07-22');
  });

  it('skips inactive definitions', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const def = await tasks.createDefinition({ title: 'Bins', recurrence: 'weekly' });
    const before = (await ctx.storage.listInstances()).length;

    await tasks.updateDefinition(def.id, { active: false });
    setSpoofedDate('2026-08-01T09:00:00');
    const result = await hydrateAll(ctx.storage, 1);

    expect(result.created).toBe(0);
    expect(await ctx.storage.listInstances()).toHaveLength(before);
  });

  it('anchors a weekly series on startDate instead of the creation date', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const def = await tasks.createDefinition({ title: 'Bins', recurrence: 'weekly', startDate: '2026-08-03' });
    expect(def.startDate).toBe('2026-08-03');

    // Future startDate → creation-time hydration materialises nothing
    // (horizon today+1 = 2026-07-21 is before the first occurrence).
    expect(await ctx.storage.listInstances()).toHaveLength(0);
    expect(def.lastHydratedDate).toBeNull();

    setSpoofedDate('2026-08-05T09:00:00');
    const result = await hydrateAll(ctx.storage, 1);
    expect(result.created).toBe(1); // 08-03 only; next occurrence 08-10 is beyond the horizon

    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate);
    expect(dates).toEqual(['2026-08-03']);
  });

  it('hydrates a quarterly task starting next month only once the horizon reaches it', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Insurance renewal', recurrence: 'quarterly', startDate: '2026-08-15' });
    expect(await ctx.storage.listInstances()).toHaveLength(0);

    setSpoofedDate('2026-08-16T09:00:00');
    await hydrateAll(ctx.storage, 1);

    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate);
    expect(dates).toEqual(['2026-08-15']); // next: 2026-11-15, far beyond the horizon
  });

  it('hydrates nothing before startDate as the spoofed clock advances, then starts on the day', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    await tasks.createDefinition({ title: 'Garden', recurrence: 'weekly', startDate: '2026-08-01' });

    // Advance to just before the start date: horizon 07-31 < 08-01 → nothing.
    setSpoofedDate('2026-07-30T09:00:00');
    const before = await hydrateAll(ctx.storage, 1);
    expect(before.created).toBe(0);
    expect(await ctx.storage.listInstances()).toHaveLength(0);

    // Cross the start date: the first occurrence materialises exactly on it.
    setSpoofedDate('2026-08-01T09:00:00');
    const after = await hydrateAll(ctx.storage, 1);
    expect(after.created).toBe(1);
    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate);
    expect(dates).toEqual(['2026-08-01']);
  });

  it('back-compat: a definition without a startDate anchors on its creation date', async () => {
    ctx = await makeTestContext('2026-07-20');
    // Simulate a pre-startDate JSON record — the field is absent entirely.
    const legacy = {
      id: randomUUID(),
      title: 'Legacy weekly',
      description: '',
      recurrence: 'weekly',
      assigneeId: null,
      dueOffsetDays: 0,
      active: true,
      lastHydratedDate: null,
      createdAt: '2026-07-06T09:00:00.000Z',
    } as TaskDefinition;
    await ctx.storage.insertDefinition(legacy);

    const result = await hydrateAll(ctx.storage, 1);
    expect(result.created).toBe(3); // anchored on 2026-07-06 (local date of createdAt)

    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate).sort();
    expect(dates).toEqual(['2026-07-06', '2026-07-13', '2026-07-20']);
  });

  it('backfills occurrences for a definition created in the past', async () => {
    ctx = await makeTestContext('2026-07-20');
    const tasks = createTaskService(ctx.storage);
    const def = await tasks.createDefinition({ title: 'Bins', recurrence: 'weekly' });
    // Simulate a definition created two weeks ago that has never hydrated.
    await ctx.storage.updateDefinition(def.id, {
      createdAt: '2026-07-06T09:00:00.000Z',
      lastHydratedDate: null,
    });
    // Clear the instances created at createDefinition time.
    for (const i of await ctx.storage.listInstances()) await ctx.storage.deleteInstance(i.id);

    const result = await hydrateAll(ctx.storage, 1);
    expect(result.created).toBe(3); // 07-06, 07-13, 07-20 (07-27 beyond horizon)

    const dates = (await ctx.storage.listInstances()).map((i) => i.occurrenceDate).sort();
    expect(dates).toEqual(['2026-07-06', '2026-07-13', '2026-07-20']);
  });
});
