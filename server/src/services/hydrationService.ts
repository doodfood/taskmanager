import { randomUUID } from 'node:crypto';
import { addWeeks, format, parseISO } from 'date-fns';
import { addDaysStr, nowIso, todayPlus } from '../clock.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { recurrenceIntervalWeeks, type Recurrence, type TaskDefinition, type TaskInstance } from '../types.js';

/** Advance a yyyy-MM-dd date by one recurrence interval (N weeks). */
export function stepDate(dateStr: string, recurrence: Exclude<Recurrence, 'none'>): string {
  const next = addWeeks(parseISO(dateStr), recurrenceIntervalWeeks(recurrence));
  return format(next, 'yyyy-MM-dd');
}

export function instanceFromDefinition(def: TaskDefinition, occurrenceDate: string): TaskInstance {
  return {
    id: randomUUID(),
    definitionId: def.id,
    title: def.title,
    description: def.description,
    assigneeId: def.assigneeId,
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
      await storage.insertInstance(instanceFromDefinition(def, cursor));
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
