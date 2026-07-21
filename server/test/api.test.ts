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
    const [alice, bob] = ctx.users;

    const def = await request(app)
      .post('/api/task-definitions')
      .send({ title: 'Mow lawn', recurrence: 'none', assigneeId: alice.id, dueOffsetDays: 2 });
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

    await request(app).post('/api/task-definitions').send({ title: 'Daily chore', recurrence: 'daily' });
    let instances = await request(app).get('/api/task-instances');
    expect(instances.body).toHaveLength(2); // today + tomorrow horizon

    const spoof = await request(app).post('/api/debug/clock').send({ date: '2026-07-25' });
    expect(spoof.status).toBe(200);
    expect(spoof.body.spoofed).toBe(true);
    expect(spoof.body.today).toBe('2026-07-25');
    expect(spoof.body.hydrated).toBe(5); // 07-22 … 07-26 (07-20/07-21 created at definition time)

    instances = await request(app).get('/api/task-instances');
    expect(instances.body).toHaveLength(7);

    const reset = await request(app).delete('/api/debug/clock');
    expect(reset.body.spoofed).toBe(false);
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
