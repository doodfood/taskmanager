import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../src/storage/SqliteStorage.js';
import type { TaskDefinition } from '../src/types.js';

let dir: string;
let storage: SqliteStorage | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'taskmanager-sqlite-'));
});

afterEach(async () => {
  storage?.close();
  storage = null;
  await rm(dir, { recursive: true, force: true });
});

const def = (over: Partial<TaskDefinition> = {}): TaskDefinition => ({
  id: 'd1',
  title: 'Bins',
  description: '',
  recurrence: 'weekly-1',
  points: 1,
  autoAssignableTo: ['u1', 'u2'],
  dueOffsetDays: 1,
  startDate: null,
  active: true,
  lastHydratedDate: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  ...over,
});

describe('SqliteStorage', () => {
  it('persists data across storage instances (round-trip through the db file)', async () => {
    const first = SqliteStorage.create(dir);
    await first.insertUser({ id: 'u1', name: 'Alice', color: '#fff', createdAt: '2026-07-20T00:00:00.000Z' });
    await first.insertDefinition(def());
    first.close();

    const second = SqliteStorage.create(dir);
    storage = second;
    expect(await second.listUsers()).toHaveLength(1);
    const got = await second.getDefinition('d1');
    expect(got?.title).toBe('Bins');
    expect(got?.autoAssignableTo).toEqual(['u1', 'u2']);
    expect(got?.active).toBe(true);
  });

  it('starts empty on a fresh database', () => {
    storage = SqliteStorage.create(dir);
    return Promise.all([
      expect(storage.listUsers()).resolves.toEqual([]),
      expect(storage.listDefinitions()).resolves.toEqual([]),
      expect(storage.listInstances()).resolves.toEqual([]),
      expect(storage.listPointEvents()).resolves.toEqual([]),
      expect(storage.listBadgeAwards()).resolves.toEqual([]),
      expect(storage.getBadgeState()).resolves.toBeNull(),
    ]);
  });

  it('updates and deletes records', async () => {
    storage = SqliteStorage.create(dir);
    await storage.insertUser({ id: 'u1', name: 'Alice', color: '#fff', createdAt: 'x' });

    expect(await storage.updateDefinition('missing', { title: 'nope' })).toBeNull();

    expect(await storage.deleteUser('u1')).toBe(true);
    expect(await storage.deleteUser('u1')).toBe(false);
    expect(await storage.listUsers()).toEqual([]);
  });

  it('updateDefinition applies patches and preserves unpatched fields', async () => {
    storage = SqliteStorage.create(dir);
    await storage.insertDefinition(def());
    const updated = await storage.updateDefinition('d1', { active: false, title: 'Bins v2' });
    expect(updated?.active).toBe(false);
    expect(updated?.title).toBe('Bins v2');
    expect(updated?.autoAssignableTo).toEqual(['u1', 'u2']);
    expect((await storage.getDefinition('d1'))?.active).toBe(false);
  });

  it('detects instance existence by (definitionId, occurrenceDate)', async () => {
    storage = SqliteStorage.create(dir);
    await storage.insertDefinition(def());
    await storage.insertInstance({
      id: 'i1',
      definitionId: 'd1',
      title: 'Bins',
      description: '',
      assigneeId: null,
      assignmentKind: 'none',
      points: 1,
      occurrenceDate: '2026-07-20',
      dueDate: '2026-07-21',
      status: 'pending',
      completedBy: null,
      completedAt: null,
      pointsAwarded: null,
      createdAt: 'x',
    });
    expect(await storage.instanceExists('d1', '2026-07-20')).toBe(true);
    expect(await storage.instanceExists('d1', '2026-07-21')).toBe(false);
    expect(await storage.instanceExists('d2', '2026-07-20')).toBe(false);
  });

  it('round-trips grant and revocation point events', async () => {
    storage = SqliteStorage.create(dir);
    await storage.insertUser({ id: 'u1', name: 'Alice', color: '#fff', createdAt: 'x' });
    await storage.insertDefinition(def());
    await storage.insertPointEvent({
      id: 'g1', kind: 'grant', userId: 'u1', instanceId: 'i1', definitionId: 'd1',
      title: 'Bins', faceValue: 10, points: 15, timing: 'early', daysLate: 0,
      completedAt: '2026-07-20T10:00:00.000Z',
    });
    await storage.insertPointEvent({
      id: 'r1', kind: 'revocation', grantId: 'g1', userId: 'u1', instanceId: 'i1',
      points: 15, reopenedAt: '2026-07-21T10:00:00.000Z',
    });
    const events = await storage.listPointEvents();
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('grant');
    expect(events[1].kind).toBe('revocation');
    const rev = events[1] as Extract<(typeof events)[number], { kind: 'revocation' }>;
    expect(rev.grantId).toBe('g1');
    expect(rev.points).toBe(15);
  });

  it('stores and returns the badge rollover state', async () => {
    storage = SqliteStorage.create(dir);
    expect(await storage.getBadgeState()).toBeNull();
    await storage.setBadgeState({ lastAwardedWeekStart: '2026-08-31', badgesEpoch: '2026-08-03' });
    const state = await storage.getBadgeState();
    expect(state?.lastAwardedWeekStart).toBe('2026-08-31');
    expect(state?.badgesEpoch).toBe('2026-08-03');
    // Update in place (upsert).
    await storage.setBadgeState({ lastAwardedWeekStart: '2026-09-07', badgesEpoch: '2026-08-03' });
    expect((await storage.getBadgeState())?.lastAwardedWeekStart).toBe('2026-09-07');
  });

  it('clear helpers remove all rows and return counts', async () => {
    storage = SqliteStorage.create(dir);
    await storage.insertDefinition(def());
    await storage.insertInstance({
      id: 'i1', definitionId: 'd1', title: 't', description: '', assigneeId: null,
      assignmentKind: 'none', points: 1, occurrenceDate: '2026-07-20', dueDate: '2026-07-21',
      status: 'pending', completedBy: null, completedAt: null, pointsAwarded: null, createdAt: 'x',
    });
    expect(await storage.clearInstances()).toBe(1);
    expect(await storage.clearInstances()).toBe(0);
    expect(await storage.listInstances()).toEqual([]);
  });
});
