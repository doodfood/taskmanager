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
