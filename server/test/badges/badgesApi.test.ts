import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { setSpoofedDate } from '../../src/clock.js';
import type { TestContext } from '../helpers.js';
import { makeTestContext } from '../helpers.js';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

describe('badges API', () => {
  it('GET /api/badges returns the catalogue without rule functions', async () => {
    ctx = await makeTestContext();
    const app = buildApp(ctx.storage);

    const res = await request(app).get('/api/badges');
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([
      'amazing-worker',
      'eager-bunny',
      'back-on-track',
      'streak-superstar',
    ]);
    const streak = res.body.find((c: { id: string }) => c.id === 'streak-superstar');
    expect(streak.badges.map((b: { id: string }) => b.id)).toEqual([
      'streak-amazing-bronze',
      'streak-amazing-silver',
      'streak-amazing-gold',
      'streak-eager-bronze',
      'streak-eager-silver',
      'streak-eager-gold',
    ]);
    for (const category of res.body) {
      for (const badge of category.badges) {
        expect(badge).toHaveProperty('tier');
        expect(badge).toHaveProperty('priority');
        expect(badge).toHaveProperty('valueKind');
        expect(badge).toHaveProperty('description');
        expect(badge).not.toHaveProperty('evaluate');
      }
    }
  });

  it('GET /api/users/:id/badges starts empty and shows live earned badges', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    const [alice] = ctx.users;

    const empty = await request(app).get(`/api/users/${alice.id}/badges`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ awarded: [], earned: [] });

    // A job starting tomorrow, completed today → early → Eager bunny pending.
    const def = await request(app)
      .post('/api/task-definitions')
      .send({ title: 'Future job', recurrence: 'none', startDate: '2026-07-21', dueOffsetDays: 1 });
    expect(def.status).toBe(201);
    const instances = await request(app).get('/api/task-instances');
    await request(app)
      .post(`/api/task-instances/${instances.body[0].id}/complete`)
      .send({ completedBy: alice.id });

    const res = await request(app).get(`/api/users/${alice.id}/badges`);
    expect(res.body.awarded).toEqual([]);
    expect(res.body.earned).toHaveLength(1);
    expect(res.body.earned[0]).toMatchObject({
      badgeId: 'eager-bunny-gold',
      categoryId: 'eager-bunny',
      tier: 'gold',
      value: 1,
    });
    expect(res.body.earned[0].description).toBeTruthy();
  });

  it('GET /api/users/:id/badges 404s for an unknown user', async () => {
    ctx = await makeTestContext();
    const app = buildApp(ctx.storage);
    const res = await request(app).get('/api/users/ghost/badges');
    expect(res.status).toBe(404);
  });

  it('POST /api/debug/award-badges runs the rollover on demand', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    const [alice] = ctx.users;

    // First ever run: initialises, awards nothing.
    const first = await request(app).post('/api/debug/award-badges');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ initialised: true, awardedWeekStart: null, awarded: 0 });

    // Complete a job in-window this week.
    await request(app).post('/api/task-definitions').send({ title: 'Chore', recurrence: 'none', dueOffsetDays: 2 });
    const instances = await request(app).get('/api/task-instances');
    await request(app)
      .post(`/api/task-instances/${instances.body[0].id}/complete`)
      .send({ completedBy: alice.id });

    // Cross the Monday boundary and trigger the ceremony.
    setSpoofedDate('2026-07-27T09:00:00');
    const second = await request(app).post('/api/debug/award-badges');
    expect(second.body).toEqual({ initialised: false, awardedWeekStart: '2026-07-20', awarded: 1 });

    // The award is now permanent on the user's record, joined with catalogue info.
    const badges = await request(app).get(`/api/users/${alice.id}/badges`);
    expect(badges.body.awarded).toHaveLength(1);
    expect(badges.body.awarded[0]).toMatchObject({
      badgeId: 'amazing-worker-bronze',
      value: null,
      weekStart: '2026-07-20',
      badge: { tier: 'bronze', categoryId: 'amazing-worker' },
    });
  });

  it('hydrated instances record assignmentKind; reassign updates it (D8)', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    const [alice, bob] = ctx.users;

    // Auto-assignable definition → instance is 'auto'.
    await request(app)
      .post('/api/task-definitions')
      .send({ title: 'Auto', recurrence: 'none', autoAssignableTo: [alice.id, bob.id] });
    // No candidates → instance is 'none' (anyone).
    await request(app).post('/api/task-definitions').send({ title: 'Anyone', recurrence: 'none' });

    const instances = (await request(app).get('/api/task-instances')).body;
    const auto = instances.find((i: { title: string }) => i.title === 'Auto');
    const anyone = instances.find((i: { title: string }) => i.title === 'Anyone');
    expect(auto.assignmentKind).toBe('auto');
    expect(anyone.assignmentKind).toBe('none');
    expect(anyone.assigneeId).toBeNull();

    // Manual assignment can credit but never punish.
    const reassigned = await request(app)
      .post(`/api/task-instances/${anyone.id}/reassign`)
      .send({ assigneeId: alice.id });
    expect(reassigned.body.assignmentKind).toBe('manual');

    // Reassigning an auto job cleanses its streak risk.
    const cleansed = await request(app)
      .post(`/api/task-instances/${auto.id}/reassign`)
      .send({ assigneeId: bob.id });
    expect(cleansed.body.assignmentKind).toBe('manual');

    // Back to "anyone" clears assignment entirely.
    const cleared = await request(app)
      .post(`/api/task-instances/${auto.id}/reassign`)
      .send({ assigneeId: null });
    expect(cleared.body.assignmentKind).toBe('none');
    expect(cleared.body.assigneeId).toBeNull();
  });
});
