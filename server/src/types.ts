/** Valid week intervals for recurring tasks: 1–13 weeks. */
export type WeeklyInterval = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** 'none' = one-off; 'weekly-N' = repeats every N weeks (N = 1…13). */
export type Recurrence = 'none' | `weekly-${WeeklyInterval}`;

export const RECURRENCES: readonly Recurrence[] = [
  'none',
  ...(Array.from({ length: 13 }, (_, i) => `weekly-${i + 1}`) as Recurrence[]),
];

/** Weeks between occurrences for a recurring cadence ('weekly-3' → 3). */
export function recurrenceIntervalWeeks(recurrence: Exclude<Recurrence, 'none'>): number {
  return Number(recurrence.slice('weekly-'.length));
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
  /**
   * Difficulty estimate (0–100, default 1). Copied onto each instance at
   * hydration time and summed to balance auto-assignment across users.
   */
  points: number;
  /**
   * Users hydrated instances may be auto-assigned to (the least busy one wins,
   * measured by outstanding points). Empty (or absent in pre-existing JSON
   * records) = no auto-assignment; instances are created for "anyone". Manual
   * (re)assignment to anyone is always possible afterwards.
   */
  autoAssignableTo: string[];
  /** due N days after each occurrence date */
  dueOffsetDays: number;
  /**
   * yyyy-MM-dd of the first occurrence. null (or absent in pre-existing JSON
   * records) = anchor the series on the creation date.
   */
  startDate: string | null;
  active: boolean;
  /** yyyy-MM-dd watermark of the last occurrence the hydration loop materialised */
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
  /** Difficulty snapshot from the definition at hydration time. */
  points: number;
  /** yyyy-MM-dd — the day this occurrence is for */
  occurrenceDate: string;
  /** yyyy-MM-dd */
  dueDate: string;
  status: TaskStatus;
  completedBy: string | null;
  completedAt: string | null; // ISO timestamp
  createdAt: string; // ISO timestamp
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string): HttpError => new HttpError(400, msg);
export const notFound = (msg: string): HttpError => new HttpError(404, msg);
export const conflict = (msg: string): HttpError => new HttpError(409, msg);
