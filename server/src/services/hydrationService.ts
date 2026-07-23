import { randomUUID } from 'node:crypto';
import { addWeeks, format, parseISO } from 'date-fns';
import { addDaysStr, nowIso, todayPlus, todayStr } from '../clock.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { recurrenceIntervalWeeks, type Recurrence, type TaskDefinition, type TaskInstance } from '../types.js';

/** Advance a yyyy-MM-dd date by one recurrence interval (N weeks). */
export function stepDate(dateStr: string, recurrence: Exclude<Recurrence, 'none'>): string {
  const next = addWeeks(parseISO(dateStr), recurrenceIntervalWeeks(recurrence));
  return format(next, 'yyyy-MM-dd');
}

/**
 * Pick the auto-assignee for a new instance: the candidate with the fewest
 * outstanding points across their open tasks. A task is open for a user when
 * it is assigned to them, not completed, and its occurrenceDate has arrived
 * (today >= occurrenceDate) — hydrated occurrences still in the future don't
 * count. Ties go to the earliest candidate in `autoAssignableTo` order.
 * Returns null ("anyone") when the definition has no candidates.
 */
export async function resolveAutoAssignee(storage: StorageProvider, def: TaskDefinition): Promise<string | null> {
  // `?? []` covers legacy JSON records where the field is absent entirely.
  const candidates = def.autoAssignableTo ?? [];
  if (candidates.length === 0) return null;

  const today = todayStr();
  const outstanding = new Map<string, number>(candidates.map((id) => [id, 0]));
  for (const instance of await storage.listInstances()) {
    if (instance.status !== 'pending') continue;
    if (instance.occurrenceDate > today) continue; // not yet actionable — ignore
    if (instance.assigneeId === null) continue;
    const current = outstanding.get(instance.assigneeId);
    if (current !== undefined) {
      // `?? 0`: legacy instances predate the points field and contribute nothing.
      outstanding.set(instance.assigneeId, current + (instance.points ?? 0));
    }
  }

  let best = candidates[0];
  for (const id of candidates) {
    if ((outstanding.get(id) ?? 0) < (outstanding.get(best) ?? 0)) best = id;
  }
  return best;
}

export async function instanceFromDefinition(
  storage: StorageProvider,
  def: TaskDefinition,
  occurrenceDate: string,
): Promise<TaskInstance> {
  return {
    id: randomUUID(),
    definitionId: def.id,
    title: def.title,
    description: def.description,
    assigneeId: await resolveAutoAssignee(storage, def),
    // `?? 1` covers legacy JSON definitions that predate the points field.
    points: def.points ?? 1,
    occurrenceDate,
    dueDate: addDaysStr(occurrenceDate, def.dueOffsetDays),
    status: 'pending',
    completedBy: null,
    completedAt: null,
    createdAt: nowIso(),
  };
}

/**
 * Materialise instances for one recurring definition, from its hydration
 * watermark (or creation date) up to and including `horizonEnd` (yyyy-MM-dd).
 * Idempotent: the (definitionId, occurrenceDate) uniqueness guard means it
 * never creates duplicates. Returns the number of instances created.
 */
export async function hydrateDefinition(
  storage: StorageProvider,
  def: TaskDefinition,
  horizonEnd: string,
): Promise<number> {
  if (!def.active || def.recurrence === 'none') return 0;

  const recurrence = def.recurrence;
  // yyyy-MM-dd strings compare correctly lexicographically.
  // The series anchors on startDate when set, otherwise on the creation date.
  // (`??` also covers legacy JSON records where the field is absent entirely.)
  // A future startDate simply hydrates nothing until the horizon catches up.
  // NB: createdAt is a UTC ISO timestamp — derive the occurrence start as the
  // *local* date so it lines up with todayStr() everywhere else.
  let cursor = def.lastHydratedDate
    ? stepDate(def.lastHydratedDate, recurrence)
    : (def.startDate ?? format(parseISO(def.createdAt), 'yyyy-MM-dd'));

  let created = 0;
  while (cursor <= horizonEnd) {
    if (!(await storage.instanceExists(def.id, cursor))) {
      await storage.insertInstance(await instanceFromDefinition(storage, def, cursor));
      created++;
    }
    if (def.lastHydratedDate !== cursor) {
      await storage.updateDefinition(def.id, { lastHydratedDate: cursor });
    }
    cursor = stepDate(cursor, recurrence);
  }
  return created;
}

/**
 * The hydration loop body: materialise occurrences for every active recurring
 * definition up to today + horizonDays.
 */
export async function hydrateAll(
  storage: StorageProvider,
  horizonDays = 1,
): Promise<{ created: number }> {
  const horizonEnd = todayPlus(horizonDays);
  const defs = await storage.listDefinitions();
  let created = 0;
  for (const def of defs) {
    created += await hydrateDefinition(storage, def, horizonEnd);
  }
  return { created };
}
