import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { TestContext } from './helpers.js';
import { makeTestContext } from './helpers.js';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.cleanup();
  ctx = null;
});

describe('API', () => {
  it('GET /api/health returns ok', async () => {
    ctx = await makeTestContext();
    const app = buildApp(ctx.storage);
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('creates and lists users', async () => {
    ctx = await makeTestContext();
    const app = buildApp(ctx.storage);

    const created = await request(app).post('/api/users').send({ name: 'Charlie' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Charlie');
    expect(created.body.color).toBeTruthy();

    const list = await request(app).get('/api/users');
    expect(list.body.map((u: { name: string }) => u.name)).toContain('Charlie');

    const bad = await request(app).post('/api/users').send({ name: '  ' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBeTruthy();
  });

  it('full task lifecycle over HTTP: create → list → complete → reopen → reassign', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    const [, bob] = ctx.users;

    const def = await request(app)
      .post('/api/task-definitions')
      .send({ title: 'Mow lawn', recurrence: 'none', dueOffsetDays: 2 });
    expect(def.status).toBe(201);

    const instances = await request(app).get('/api/task-instances?status=pending');
    expect(instances.body).toHaveLength(1);
    const instance = instances.body[0];
    expect(instance.dueDate).toBe('2026-07-22');

    const completed = await request(app)
      .post(`/api/task-instances/${instance.id}/complete`)
      .send({ completedBy: bob.id });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.completedBy).toBe(bob.id);

    const reopened = await request(app).post(`/api/task-instances/${instance.id}/reopen`);
    expect(reopened.body.status).toBe('pending');

    const reassigned = await request(app)
      .post(`/api/task-instances/${instance.id}/reassign`)
      .send({ assigneeId: null });
    expect(reassigned.body.assigneeId).toBeNull();
  });

  it('GET /api/task-instances/upcoming requires a valid userId', async () => {
    ctx = await makeTestContext();
    const app = buildApp(ctx.storage);

    const missing = await request(app).get('/api/task-instances/upcoming');
    expect(missing.status).toBe(400);

    const unknown = await request(app).get('/api/task-instances/upcoming?userId=ghost');
    expect(unknown.status).toBe(400);

    const ok = await request(app).get(`/api/task-instances/upcoming?userId=${ctx.users[0].id}&days=7`);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);
  });

  it('clock spoof endpoint advances time and re-hydrates recurring tasks', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);

    await request(app).post('/api/task-definitions').send({ title: 'Weekly chore', recurrence: 'weekly-1' });
    let instances = await request(app).get('/api/task-instances');
    expect(instances.body).toHaveLength(1); // today's occurrence; next is a week out

    const spoof = await request(app).post('/api/debug/clock').send({ date: '2026-07-25' });
    expect(spoof.status).toBe(200);
    expect(spoof.body.spoofed).toBe(true);
    expect(spoof.body.today).toBe('2026-07-25');
    // Default horizon is 5 days (HYDRATION_HORIZON_DAYS) → horizon 07-30, so the
    // spoof jump materialises 07-27 (07-20 was created at definition time).
    expect(spoof.body.hydrated).toBe(1);

    instances = await request(app).get('/api/task-instances');
    expect(instances.body).toHaveLength(2);

    const reset = await request(app).delete('/api/debug/clock');
    expect(reset.body.spoofed).toBe(false);
  });

  it('debug reset endpoints clear instances and reset hydration watermarks', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);

    // Hydrate a weekly definition across the horizon.
    await request(app).post('/api/task-definitions').send({ title: 'Weekly chore', recurrence: 'weekly-1' });
    expect((await request(app).get('/api/task-instances')).body).toHaveLength(1);
    const defsBefore = await request(app).get('/api/task-definitions');
    expect(defsBefore.body[0].lastHydratedDate).not.toBeNull();

    // Reset watermarks only: instances stay, watermark goes back to null.
    const watermarks = await request(app).post('/api/debug/reset-watermarks');
    expect(watermarks.status).toBe(200);
    expect(watermarks.body.reset).toBe(1);
    expect((await request(app).get('/api/task-instances')).body).toHaveLength(1);
    const defsAfter = await request(app).get('/api/task-definitions');
    expect(defsAfter.body[0].lastHydratedDate).toBeNull();
    // Idempotent: nothing left to reset.
    expect((await request(app).post('/api/debug/reset-watermarks')).body.reset).toBe(0);

    // Clear instances only: definitions untouched.
    const cleared = await request(app).post('/api/debug/clear-instances');
    expect(cleared.status).toBe(200);
    expect(cleared.body.cleared).toBe(1);
    expect((await request(app).get('/api/task-instances')).body).toHaveLength(0);
    // Idempotent: nothing left to clear.
    expect((await request(app).post('/api/debug/clear-instances')).body.cleared).toBe(0);

    // The full testing loop: after clear + reset, jumping the clock rehydrates
    // the whole series from the definition anchor.
    const spoof = await request(app).post('/api/debug/clock').send({ date: '2026-07-25' });
    expect(spoof.body.hydrated).toBe(2); // 07-20 and 07-27 (horizon 07-30)
    expect((await request(app).get('/api/task-instances')).body).toHaveLength(2);
  });

  it('POST /api/debug/clear-points wipes the ledger and task point snapshots', async () => {
    ctx = await makeTestContext('2026-07-20');
    const app = buildApp(ctx.storage);
    const [, bob] = ctx.users;

    // Complete a job so a grant lands in the ledger and on the instance.
    await request(app).post('/api/task-definitions').send({ title: 'Chore', recurrence: 'none', points: 20 });
    const instances = await request(app).get('/api/task-instances');
    const completed = await request(app)
      .post(`/api/task-instances/${instances.body[0].id}/complete`)
      .send({ completedBy: bob.id });
    expect(completed.body.pointsAwarded).toBeGreaterThan(0);
    const before = await request(app).get('/api/leaderboard?weeks=1');
    expect(before.body.find((e: { user: { id: string } }) => e.user.id === bob.id).totalPoints).toBeGreaterThan(0);

    // Clear: ledger emptied, snapshot nulled, balances back to zero.
    const cleared = await request(app).post('/api/debug/clear-points');
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ cleared: 1, snapshotsCleared: 1 });
    expect(await ctx.storage.listPointEvents()).toEqual([]);
    const instance = await request(app).get(`/api/task-instances?status=completed`);
    expect(instance.body[0].pointsAwarded).toBeNull();
    const after = await request(app).get('/api/leaderboard?weeks=1');
    for (const entry of after.body) {
      expect(entry.totalPoints).toBe(0);
      expect(entry.tasksCompleted).toBe(0);
    }

    // Idempotent: nothing left to clear.
    expect((await request(app).post('/api/debug/clear-points')).body).toEqual({
      cleared: 0,
      snapshotsCleared: 0,
    });
  });

  it('rejects an invalid spoof date', async () => {
    ctx = await makeTestContext();
    const app = buildApp(ctx.storage);
    const res = await request(app).post('/api/debug/clock').send({ date: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  it('404s on unknown routes and missing resources', async () => {
    ctx = await makeTestContext();
    const app = buildApp(ctx.storage);

    expect((await request(app).get('/api/nope')).status).toBe(404);
    expect((await request(app).post('/api/task-instances/ghost/complete').send({ completedBy: ctx.users[0].id })).status).toBe(404);
  });
});
