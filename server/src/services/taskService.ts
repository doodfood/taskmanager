import { randomUUID } from 'node:crypto';
import { format, isValid, parseISO } from 'date-fns';
import { nowIso, todayPlus, todayStr } from '../clock.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import {
  RECURRENCES,
  badRequest,
  conflict,
  notFound,
  type Recurrence,
  type TaskDefinition,
  type TaskInstance,
} from '../types.js';
import { hydrateDefinition, instanceFromDefinition } from './hydrationService.js';

export interface CreateDefinitionInput {
  title?: unknown;
  description?: unknown;
  recurrence?: unknown;
  points?: unknown;
  autoAssignableTo?: unknown;
  dueOffsetDays?: unknown;
  startDate?: unknown;
}

export interface InstanceFilters {
  assigneeId?: string | null; // undefined = no filter, null = "anyone" tasks only
  status?: 'pending' | 'completed';
  from?: string; // dueDate >= from (yyyy-MM-dd)
  to?: string; // dueDate <= to (yyyy-MM-dd)
  includeAnyone?: boolean; // when assigneeId is set, also include unassigned tasks
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalise a startDate input: undefined/null/'' → null (anchor on creation
 * date); otherwise require a real yyyy-MM-dd calendar date. The format()
 * round-trip catches impossible dates like 2026-02-30 even if the parser
 * rolls them over instead of rejecting them.
 */
function validateStartDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw badRequest('startDate must be a yyyy-MM-dd date string or null');
  }
  const parsed = parseISO(value);
  if (!isValid(parsed) || format(parsed, 'yyyy-MM-dd') !== value) {
    throw badRequest('startDate must be a valid calendar date (yyyy-MM-dd)');
  }
  return value;
}

function validateAssignee(storage: StorageProvider, assigneeId: unknown): Promise<string | null> {
  if (assigneeId === undefined || assigneeId === null || assigneeId === '') return Promise.resolve(null);
  if (typeof assigneeId !== 'string') throw badRequest('assigneeId must be a string or null');
  return storage.getUser(assigneeId).then((user) => {
    if (!user) throw badRequest(`assigneeId ${assigneeId} does not match an existing user`);
    return assigneeId;
  });
}

/** Difficulty estimate: undefined/null/'' → default 1, otherwise an integer 0–100. */
function validatePoints(value: unknown): number {
  if (value === undefined || value === null || value === '') return 1;
  let points = value;
  if (typeof points === 'string' && points.trim() !== '') points = Number(points);
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > 100) {
    throw badRequest('points must be an integer between 0 and 100');
  }
  return points;
}

/** Auto-assignment candidates: undefined/null → default [], otherwise a deduped list of existing user ids. */
async function validateAutoAssignableTo(storage: StorageProvider, value: unknown): Promise<string[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('autoAssignableTo must be an array of user ids');
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') {
      throw badRequest('autoAssignableTo must be an array of user ids');
    }
    if (ids.includes(entry)) continue; // dedupe, preserving order
    if (!(await storage.getUser(entry))) {
      throw badRequest(`autoAssignableTo entry ${entry} does not match an existing user`);
    }
    ids.push(entry);
  }
  return ids;
}

export function createTaskService(storage: StorageProvider) {
  async function requireInstance(id: string): Promise<TaskInstance> {
    const instance = await storage.getInstance(id);
    if (!instance) throw notFound(`task instance ${id} not found`);
    return instance;
  }

  return {
    // ---------- Definitions ----------

    listDefinitions(): Promise<TaskDefinition[]> {
      return storage.listDefinitions();
    },

    async createDefinition(input: CreateDefinitionInput): Promise<TaskDefinition> {
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title) throw badRequest('title is required');

      const recurrence = (input.recurrence ?? 'none') as Recurrence;
      if (!RECURRENCES.includes(recurrence)) {
        throw badRequest("recurrence must be 'none' or 'weekly-N' with N between 1 and 13");
      }

      let dueOffsetDays = input.dueOffsetDays ?? 0;
      if (typeof dueOffsetDays === 'string' && dueOffsetDays.trim() !== '') dueOffsetDays = Number(dueOffsetDays);
      if (typeof dueOffsetDays !== 'number' || !Number.isInteger(dueOffsetDays) || dueOffsetDays < 0 || dueOffsetDays > 365) {
        throw badRequest('dueOffsetDays must be an integer between 0 and 365');
      }

      const points = validatePoints(input.points);
      const autoAssignableTo = await validateAutoAssignableTo(storage, input.autoAssignableTo);
      const startDate = validateStartDate(input.startDate);

      const def: TaskDefinition = {
        id: randomUUID(),
        title,
        description: typeof input.description === 'string' ? input.description.trim() : '',
        recurrence,
        points,
        autoAssignableTo,
        dueOffsetDays,
        startDate,
        active: true,
        lastHydratedDate: null,
        createdAt: nowIso(),
      };
      await storage.insertDefinition(def);

      if (recurrence === 'none') {
        // One-off: materialise its single instance immediately, on the
        // requested start date (default: today).
        const occurrenceDate = startDate ?? todayStr();
        await storage.insertInstance(await instanceFromDefinition(storage, def, occurrenceDate));
        await storage.updateDefinition(def.id, { lastHydratedDate: occurrenceDate });
      } else {
        // Recurring: hydrate right away so the first occurrence shows up now.
        // A future startDate naturally hydrates nothing until the horizon
        // catches up (see hydrateDefinition).
        await hydrateDefinition(storage, def, todayPlus(1));
      }
      return (await storage.getDefinition(def.id)) ?? def;
    },

    async updateDefinition(id: string, patch: CreateDefinitionInput & { active?: unknown }): Promise<TaskDefinition> {
      const def = await storage.getDefinition(id);
      if (!def) throw notFound(`task definition ${id} not found`);

      const updates: Partial<Omit<TaskDefinition, 'id'>> = {};
      if (patch.title !== undefined) {
        const title = typeof patch.title === 'string' ? patch.title.trim() : '';
        if (!title) throw badRequest('title must be a non-empty string');
        updates.title = title;
      }
      if (patch.description !== undefined) {
        if (typeof patch.description !== 'string') throw badRequest('description must be a string');
        updates.description = patch.description.trim();
      }
      if (patch.recurrence !== undefined) {
        if (!RECURRENCES.includes(patch.recurrence as Recurrence)) {
          throw badRequest("recurrence must be 'none' or 'weekly-N' with N between 1 and 13");
        }
        updates.recurrence = patch.recurrence as Recurrence;
      }
      if (patch.points !== undefined) {
        updates.points = validatePoints(patch.points);
      }
      if (patch.autoAssignableTo !== undefined) {
        updates.autoAssignableTo = await validateAutoAssignableTo(storage, patch.autoAssignableTo);
      }
      if (patch.dueOffsetDays !== undefined) {
        const n = Number(patch.dueOffsetDays);
        if (!Number.isInteger(n) || n < 0 || n > 365) throw badRequest('dueOffsetDays must be an integer between 0 and 365');
        updates.dueOffsetDays = n;
      }
      // Caveat: once hydration has begun, the lastHydratedDate watermark
      // drives the series — changing startDate does not move already-hydrated
      // instances (same snapshot semantics as other edits).
      if (patch.startDate !== undefined) {
        updates.startDate = validateStartDate(patch.startDate);
      }
      if (patch.active !== undefined) {
        if (typeof patch.active !== 'boolean') throw badRequest('active must be a boolean');
        updates.active = patch.active;
      }

      const updated = await storage.updateDefinition(id, updates);
      if (!updated) throw notFound(`task definition ${id} not found`);
      return updated;
    },

    async deleteDefinition(id: string): Promise<void> {
      const def = await storage.getDefinition(id);
      if (!def) throw notFound(`task definition ${id} not found`);
      // Remove future/pending instances too; completed ones stay as history.
      const instances = await storage.listInstances();
      for (const instance of instances) {
        if (instance.definitionId === id && instance.status === 'pending') {
          await storage.deleteInstance(instance.id);
        }
      }
      await storage.deleteDefinition(id);
    },

    // ---------- Instances ----------

    async listInstances(filters: InstanceFilters = {}): Promise<TaskInstance[]> {
      let instances = await storage.listInstances();
      if (filters.status) instances = instances.filter((i) => i.status === filters.status);
      if (filters.assigneeId !== undefined) {
        instances = instances.filter(
          (i) =>
            i.assigneeId === filters.assigneeId ||
            (filters.includeAnyone === true && i.assigneeId === null),
        );
      }
      if (filters.from) instances = instances.filter((i) => i.dueDate >= filters.from!);
      if (filters.to) instances = instances.filter((i) => i.dueDate <= filters.to!);
      return instances.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
    },

    /**
     * "My week": pending tasks due on or before today + days, assigned to the
     * user or to anyone. Overdue tasks (dueDate < today) are included.
     */
    async upcoming(userId: string, days = 7): Promise<TaskInstance[]> {
      if (!Number.isInteger(days) || days < 1 || days > 90) throw badRequest('days must be an integer between 1 and 90');
      const user = await storage.getUser(userId);
      if (!user) throw badRequest(`userId ${userId} does not match an existing user`);
      const horizon = todayPlus(days);
      const instances = await storage.listInstances();
      return instances
        .filter(
          (i) =>
            i.status === 'pending' &&
            i.dueDate <= horizon &&
            (i.assigneeId === userId || i.assigneeId === null),
        )
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
    },

    async complete(id: string, completedBy: unknown): Promise<TaskInstance> {
      const instance = await requireInstance(id);
      if (instance.status === 'completed') throw conflict(`task instance ${id} is already completed`);
      const by = await validateAssignee(storage, completedBy);
      if (by === null) throw badRequest('completedBy is required and must be an existing user id');
      const updated = await storage.updateInstance(id, {
        status: 'completed',
        completedBy: by,
        completedAt: nowIso(),
      });
      return updated!;
    },

    async reopen(id: string): Promise<TaskInstance> {
      const instance = await requireInstance(id);
      if (instance.status === 'pending') throw conflict(`task instance ${id} is already pending`);
      const updated = await storage.updateInstance(id, {
        status: 'pending',
        completedBy: null,
        completedAt: null,
      });
      return updated!;
    },

    async reassign(id: string, assigneeId: unknown): Promise<TaskInstance> {
      await requireInstance(id);
      const target = await validateAssignee(storage, assigneeId);
      const updated = await storage.updateInstance(id, { assigneeId: target });
      return updated!;
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
