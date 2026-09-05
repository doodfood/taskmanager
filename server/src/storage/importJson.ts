/**
 * Shared logic for the one-off JSON -> SQLite data import. Kept in src/ (not
 * scripts/) so it compiles into dist/ and can run on the Pi under plain node.
 *
 * Idempotent: if the users table is already non-empty the import is skipped.
 * Existing databases are never wiped — the migration runner owns all schema
 * changes; this only moves data from JSON files into a fresh, empty database.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { SqliteStorage } from './SqliteStorage.js';
import type {
  BadgeAward,
  BadgeState,
  PointEvent,
  TaskDefinition,
  TaskInstance,
  User,
} from '../types.js';

async function readJson<T>(dir: string, file: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(dir, file), 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Import the legacy JSON files from `jsonDir` into the SQLite db in `dataDir`.
 * Defaults both to config.dataDir. No-op when the database already has users.
 */
export async function importJsonToSqlite(
  jsonDirArg?: string,
  dataDirArg?: string,
): Promise<void> {
  const jsonDir = path.resolve(jsonDirArg ?? config.dataDir);
  const dataDir = path.resolve(dataDirArg ?? config.dataDir);

  console.log(`[import] json source : ${jsonDir}`);
  console.log(`[import] sqlite dest : ${dataDir}`);

  const storage = SqliteStorage.create(dataDir);

  // Idempotency guard: only import into an empty database.
  const existing = await storage.listUsers();
  if (existing.length > 0) {
    console.log(`[import] database already has ${existing.length} user(s) — skipping import (nothing to do).`);
    storage.close();
    return;
  }

  const users = (await readJson<User[]>(jsonDir, 'users.json')) ?? [];
  const definitions = (await readJson<TaskDefinition[]>(jsonDir, 'task-definitions.json')) ?? [];
  const instances = (await readJson<TaskInstance[]>(jsonDir, 'task-instances.json')) ?? [];
  const pointEvents = (await readJson<PointEvent[]>(jsonDir, 'point-events.json')) ?? [];
  const badgeAwards = (await readJson<BadgeAward[]>(jsonDir, 'badge-awards.json')) ?? [];
  const badgeState = await readJson<BadgeState>(jsonDir, 'badge-state.json');

  for (const u of users) await storage.insertUser(u);
  for (const d of definitions) {
    await storage.insertDefinition({
      ...d,
      autoAssignableTo: d.autoAssignableTo ?? [],
      startDate: d.startDate ?? null,
      lastHydratedDate: d.lastHydratedDate ?? null,
    });
  }
  for (const i of instances) {
    await storage.insertInstance({
      ...i,
      assigneeId: i.assigneeId ?? null,
      completedBy: i.completedBy ?? null,
      completedAt: i.completedAt ?? null,
      pointsAwarded: i.pointsAwarded ?? null,
    });
  }
  for (const e of pointEvents) await storage.insertPointEvent(e);
  for (const b of badgeAwards) await storage.insertBadgeAward({ ...b, value: b.value ?? null });
  if (badgeState) await storage.setBadgeState(badgeState);

  console.log(
    `[import] done: ${users.length} users, ${definitions.length} definitions, ` +
      `${instances.length} instances, ${pointEvents.length} point events, ` +
      `${badgeAwards.length} badge awards, badge state ${badgeState ? 'set' : 'absent'}.`,
  );
  storage.close();
}
