/**
 * Seed script: inserts the household users and the cleaning-rota task
 * definitions through the HTTP API.
 *
 * Goes through the API (not the JSON files directly) because a running server
 * caches storage in memory — file writes would be clobbered. Start the API
 * first (`npm run dev` or `npm run dev:server`).
 *
 * Safe to re-run: users are matched by name and definitions by title, so
 * anything already present is skipped. Existing definitions whose
 * autoAssignableTo list has drifted from the desired one are updated in
 * place. After clearing tasks (debug panel or deleting server/data/), just
 * run it again.
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

/** Default auto-assign pool for tasks that don't override it. */
const DEFAULT_AUTO_ASSIGN = ['Akhil', 'Eriko'];

interface SeedTask {
  title: string;
  /** yyyy-MM-dd of the first occurrence. */
  startDate: string;
  /** Days after the occurrence the instance is due (0 = same day). */
  dueOffsetDays: number;
  /**
   * Names of the users new occurrences may be auto-assigned to (the least
   * busy one wins). Defaults to DEFAULT_AUTO_ASSIGN.
   */
  autoAssign?: string[];
}

const TASKS: SeedTask[] = [
  {
    title: 'Clean bathroom 1 floor',
    startDate: '2026-08-08',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko', 'Maya', 'Neha'],
  },
  {
    title: 'Clean bathroom 1 toilet bowl inside and outside and wipe flush tank',
    startDate: '2026-08-29',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko', 'Maya', 'Neha'],
  },
  {
    title: 'Wipe the kitchen cupboard doors',
    startDate: '2026-09-05',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko', 'Maya', 'Neha'],
  },

  {
    title: 'Clean bathroom 2 floor',
    startDate: '2026-08-15',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko', 'Maya', 'Neha'],
  },
  {
    title: 'Clean shower 1 walls and floor rails',
    startDate: '2026-08-15',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko'],
  },
  {
    title: 'Clean shower 2 screen and floor rails',
    startDate: '2026-08-08',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko'],
  },
  {
    title: 'Clean the microwave inside and outside',
    startDate: '2026-08-08',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko'],
  },
  {
    title: 'Dust under all the sofas',
    startDate: '2026-08-22',
    dueOffsetDays: 1,
    autoAssign: ['Maya', 'Neha'],
  },
  {
    title: 'Dust all the blinds',
    startDate: '2026-08-22',
    dueOffsetDays: 1,
    autoAssign: ['Maya', 'Neha'],
  },
  {
    title: 'Dusting (no blinds, not under sofas)',
    startDate: '2026-08-29',
    dueOffsetDays: 1,
    autoAssign: ['Maya', 'Neha'],
  },
  {
    title: 'Mopping/wiping edges of floors',
    startDate: '2026-08-29',
    dueOffsetDays: 1,
    autoAssign: ['Maya', 'Neha'],
  },  
  {
    title: 'Vacuum all the places vac vac cant reach',
    startDate: '2026-08-22',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko'],
  },
  {
    title: 'Wipe the fridge outside and side as much as possible',
    startDate: '2026-08-15',
    dueOffsetDays: 1,
    autoAssign: ['Maya', 'Neha'],
  },
  {
    title: 'Clean the oven inside and wipe outside',
    startDate: '2026-08-15',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko'],
  },
  {
    title: 'Clean the stove top and knobs',
    startDate: '2026-08-22',
    dueOffsetDays: 1,
    autoAssign: ['Akhil', 'Eriko'],
  },
  {
    title: 'Mowing edging hedging weed killer spray',
    startDate: '2026-08-29',
    dueOffsetDays: 1,
    autoAssign: ['Akhil'],
  },
    {
    title: 'Clean the air filter',
    startDate: '2026-08-29',
    dueOffsetDays: 1,
    autoAssign: ['Eriko'],
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

/** Order-sensitive comparison — candidate order is the tie-break, so it matters. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
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

  // Resolve names → ids for the auto-assign pools (users may have pre-existed).
  const allUsers = await api<User[]>('GET', '/api/users');
  const idByName = new Map(allUsers.map((u) => [u.name.toLowerCase(), u.id]));
  const idsFor = (names: string[]): string[] =>
    names.map((name) => {
      const id = idByName.get(name.toLowerCase());
      if (!id) throw new Error(`seed user ${name} is missing — cannot build auto-assign pool`);
      return id;
    });

  const existingDefs = await api<TaskDefinition[]>('GET', '/api/task-definitions');
  const defByTitle = new Map(existingDefs.map((d) => [d.title.toLowerCase(), d]));
  for (const task of TASKS) {
    const autoAssign = task.autoAssign ?? DEFAULT_AUTO_ASSIGN;
    const autoAssignableTo = idsFor(autoAssign);
    const autoLabel = `auto → ${autoAssign.join(', ')}`;

    const existing = defByTitle.get(task.title.toLowerCase());
    if (existing) {
      if (sameIds(existing.autoAssignableTo ?? [], autoAssignableTo)) {
        console.log(`  task  skip    ${task.title} (already exists)`);
        continue;
      }
      await api<TaskDefinition>('PATCH', `/api/task-definitions/${existing.id}`, { autoAssignableTo });
      console.log(`  task  updated ${task.title} — ${autoLabel}`);
      continue;
    }

    await api<TaskDefinition>('POST', '/api/task-definitions', {
      title: task.title,
      recurrence: RECURRENCE,
      autoAssignableTo,
      dueOffsetDays: task.dueOffsetDays,
      startDate: task.startDate,
    });
    const due = task.dueOffsetDays === 0 ? 'same day' : `+${task.dueOffsetDays} days`;
    console.log(`  task  created ${task.title} — every 4 weeks from ${task.startDate}, due ${due}, ${autoLabel}`);
  }

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error(`Seed failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
