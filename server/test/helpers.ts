import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setSpoofedDate } from '../src/clock.js';
import { createUserService } from '../src/services/userService.js';
import { JsonFileStorage } from '../src/storage/JsonFileStorage.js';
import type { User } from '../src/types.js';

export interface TestContext {
  storage: JsonFileStorage;
  users: User[];
  cleanup: () => Promise<void>;
}

/** Fresh JSON storage in a temp dir, spoofed clock, two seeded users. */
export async function makeTestContext(today = '2026-07-20'): Promise<TestContext> {
  const dir = await mkdtemp(path.join(tmpdir(), 'taskmanager-test-'));
  setSpoofedDate(`${today}T09:00:00`);
  const storage = await JsonFileStorage.create(dir);
  const userService = createUserService(storage);
  const users: User[] = [];
  for (const name of ['Alice', 'Bob']) {
    users.push(await userService.create({ name }));
  }
  return {
    storage,
    users,
    cleanup: async () => {
      setSpoofedDate(null);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
