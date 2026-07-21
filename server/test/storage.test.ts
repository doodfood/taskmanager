import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFileStorage } from '../src/storage/JsonFileStorage.js';
import type { TaskDefinition } from '../src/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'taskmanager-storage-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonFileStorage', () => {
  it('persists data across storage instances (round-trip through the JSON files)', async () => {
    const first = await JsonFileStorage.create(dir);
    await first.insertUser({ id: 'u1', name: 'Alice', color: '#fff', createdAt: '2026-07-20T00:00:00.000Z' });
    await first.insertDefinition({
      id: 'd1',
      title: 'Bins',
      description: '',
      recurrence: 'weekly',
      assigneeId: null,
      dueOffsetDays: 1,
      active: true,
      lastHydratedDate: null,
      createdAt: '2026-07-20T00:00:00.000Z',
    });

    const second = await JsonFileStorage.create(dir);
    expect(await second.listUsers()).toHaveLength(1);
    const def = await second.getDefinition('d1');
    expect(def?.title).toBe('Bins');
  });

  it('starts empty when files do not exist', async () => {
    const storage = await JsonFileStorage.create(dir);
    expect(await storage.listUsers()).toEqual([]);
    expect(await storage.listDefinitions()).toEqual([]);
    expect(await storage.listInstances()).toEqual([]);
  });

  it('updates and deletes records', async () => {
    const storage = await JsonFileStorage.create(dir);
    await storage.insertUser({ id: 'u1', name: 'Alice', color: '#fff', createdAt: 'x' });

    const patched = await storage.updateDefinition('missing', { title: 'nope' });
    expect(patched).toBeNull();

    expect(await storage.deleteUser('u1')).toBe(true);
    expect(await storage.deleteUser('u1')).toBe(false);
    expect(await storage.listUsers()).toEqual([]);
  });

  it('detects instance existence by (definitionId, occurrenceDate)', async () => {
    const storage = await JsonFileStorage.create(dir);
    await storage.insertInstance({
      id: 'i1',
      definitionId: 'd1',
      title: 'Bins',
      description: '',
      assigneeId: null,
      occurrenceDate: '2026-07-20',
      dueDate: '2026-07-21',
      status: 'pending',
      completedBy: null,
      completedAt: null,
      createdAt: 'x',
    });
    expect(await storage.instanceExists('d1', '2026-07-20')).toBe(true);
    expect(await storage.instanceExists('d1', '2026-07-21')).toBe(false);
    expect(await storage.instanceExists('d2', '2026-07-20')).toBe(false);
  });

  it('updateDefinition applies patches', async () => {
    const storage = await JsonFileStorage.create(dir);
    const def: TaskDefinition = {
      id: 'd1',
      title: 'Bins',
      description: '',
      recurrence: 'weekly',
      assigneeId: null,
      dueOffsetDays: 1,
      active: true,
      lastHydratedDate: null,
      createdAt: 'x',
    };
    await storage.insertDefinition(def);
    const updated = await storage.updateDefinition('d1', { active: false, title: 'Bins v2' });
    expect(updated?.active).toBe(false);
    expect(updated?.title).toBe('Bins v2');
    expect((await storage.getDefinition('d1'))?.active).toBe(false);
  });
});
