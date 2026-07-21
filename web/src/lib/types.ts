/** Shared API types — mirrors server/src/types.ts. Keep in sync manually. */

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'quarterly';

export const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly', 'quarterly'];

export type TaskStatus = 'pending' | 'completed';

export interface User {
  id: string;
  name: string;
  color: string;
  createdAt: string; // ISO timestamp
}

/** The template — describes what repeats. */
export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  recurrence: Recurrence;
  /** null = assigned to "anyone" */
  assigneeId: string | null;
  /** due N days after each occurrence date */
  dueOffsetDays: number;
  active: boolean;
  lastHydratedDate: string | null;
  createdAt: string; // ISO timestamp
}

/** A concrete, actionable task materialised from a definition. */
export interface TaskInstance {
  id: string;
  definitionId: string;
  title: string;
  description: string;
  /** null = anyone can do it */
  assigneeId: string | null;
  /** yyyy-MM-dd — the day this occurrence is for */
  occurrenceDate: string;
  /** yyyy-MM-dd */
  dueDate: string;
  status: TaskStatus;
  completedBy: string | null;
  completedAt: string | null; // ISO timestamp
  createdAt: string; // ISO timestamp
}

/** Shape returned by GET /api/debug/clock (POST adds `hydrated`). */
export interface ClockState {
  spoofed: boolean;
  spoofedDate: string | null;
  now: string; // ISO timestamp
  today: string; // yyyy-MM-dd — the server's effective "today"
}
