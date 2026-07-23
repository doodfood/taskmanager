/**
 * Seed script: inserts the household users and the cleaning-rota task
 * definitions through the HTTP API.
 *
 * Goes through the API (not the JSON files directly) because a running server
 * caches storage in memory — file writes would be clobbered. Start the API
 * first (`npm run dev` or `npm run dev:server`).
 *
 * Safe to re-run: users are matched by name and definitions by title, so
 * anything already present is skipped. After clearing tasks (debug panel or
 * deleting server/data/), just run it again.
 *
 * Usage:
 *   npm run seed                              # from the repo root or server/
 *   API_URL=http://localhost:4000 npm run seed
 */

import type { TaskDefinition, User } from '../src/types.js';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const USERS = ['Akhil', 'Eriko', 'Maya', 'Neha'];

/** "Monthly" in the rota maps to every 4 weeks. */
const RECURRENCE = 'weekly-4';

interface SeedTask {
  title: string;
  /** yyyy-MM-dd of the first occurrence. */
  startDate: string;
  /** Days after the occurrence the instance is due (0 = same day). */
  dueOffsetDays: number;
}

const TASKS: SeedTask[] = [
  { title: 'Clean bathroom 1 floor', startDate: '2026-07-25', dueOffsetDays: 7 },
  {
    title: 'Clean bathroom 1 toilet bowl inside and outside and wipe flush tank',
    startDate: '2026-08-14',
    dueOffsetDays: 7,
  },
  { title: 'Clean bathroom 2 floor', startDate: '2026-08-01', dueOffsetDays: 7 },
  { title: 'Clean shower 1 walls and floor rails', startDate: '2026-08-01', dueOffsetDays: 0 },
  { title: 'Clean shower 2 screen and floor rails', startDate: '2026-07-25', dueOffsetDays: 7 },
  { title: 'Clean the microwave inside and outside', startDate: '2026-07-25', dueOffsetDays: 7 },
  { title: 'Dust under all the sofas', startDate: '2026-08-08', dueOffsetDays: 0 },
  { title: 'vacuum all the places vac vac cant reach', startDate: '2026-08-08', dueOffsetDays: 0 },
  {
    title: 'Wipe the fridge outside and side as much as possible',
    startDate: '2026-08-01',
    dueOffsetDays: 7,
  },
];

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  try {
    await api<{ ok: boolean }>('GET', '/api/health');
  } catch {
    throw new Error(`API not reachable at ${API_URL} — start it first (npm run dev:server)`);
  }
  console.log(`Seeding via ${API_URL}`);

  const existingUsers = await api<User[]>('GET', '/api/users');
  const userNames = new Set(existingUsers.map((u) => u.name.toLowerCase()));
  for (const name of USERS) {
    if (userNames.has(name.toLowerCase())) {
      console.log(`  user  skip    ${name} (already exists)`);
      continue;
    }
    const user = await api<User>('POST', '/api/users', { name });
    console.log(`  user  created ${user.name}`);
  }

  const existingDefs = await api<TaskDefinition[]>('GET', '/api/task-definitions');
  const defTitles = new Set(existingDefs.map((d) => d.title.toLowerCase()));
  for (const task of TASKS) {
    if (defTitles.has(task.title.toLowerCase())) {
      console.log(`  task  skip    ${task.title} (already exists)`);
      continue;
    }
    await api<TaskDefinition>('POST', '/api/task-definitions', {
      title: task.title,
      recurrence: RECURRENCE,
      assigneeId: null, // Anyone
      dueOffsetDays: task.dueOffsetDays,
      startDate: task.startDate,
    });
    const due = task.dueOffsetDays === 0 ? 'same day' : `+${task.dueOffsetDays} days`;
    console.log(`  task  created ${task.title} — every 4 weeks from ${task.startDate}, due ${due}`);
  }

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error(`Seed failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
