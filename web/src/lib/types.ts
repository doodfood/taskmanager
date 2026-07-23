/** Shared API types — mirrors server/src/types.ts. Keep in sync manually. */

/** Valid week intervals for recurring tasks: 1–13 weeks. */
export type WeeklyInterval = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** 'none' = one-off; 'weekly-N' = repeats every N weeks (N = 1…13). */
export type Recurrence = 'none' | `weekly-${WeeklyInterval}`;

export const RECURRENCES: readonly Recurrence[] = [
  'none',
  ...(Array.from({ length: 13 }, (_, i) => `weekly-${i + 1}`) as Recurrence[]),
];

/** Human label for a recurrence ('weekly-3' → 'Every 3 weeks'). */
export function recurrenceLabel(recurrence: Recurrence): string {
  if (recurrence === 'none') return 'One-off';
  const weeks = Number(recurrence.slice('weekly-'.length));
  return weeks === 1 ? 'Weekly' : `Every ${weeks} weeks`;
}

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
  /** yyyy-MM-dd of the first occurrence; null = anchored on the creation date */
  startDate: string | null;
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
