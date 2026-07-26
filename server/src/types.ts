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

/** Points given to a new task definition when none is supplied on create. */
export const DEFAULT_POINTS = 10;

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
   * Difficulty estimate (0–100, default {@link DEFAULT_POINTS}). Copied onto
   * each instance at hydration time and summed to balance auto-assignment
   * across users. Doubles as the face value for points scoring on completion.
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
  /**
   * Points actually awarded for the current completion (early/on-time/late
   * adjustment applied) — a display snapshot so cards can show "+15" without
   * reading the ledger. null (or absent in pre-existing JSON records) = no
   * award: pending, or completed before gamification shipped. The points
   * ledger remains the authoritative record.
   */
  pointsAwarded: number | null;
  createdAt: string; // ISO timestamp
}

// ---------- Points ledger ----------

/** How the completion date compared to the due date, for display. */
export type PointTiming = 'early' | 'on-time' | 'late';

/**
 * Append-only record of a completion award: who earned it, on which task
 * instance, how much, when, and the timing outcome. Snapshotted at
 * completion time — later definition edits or scoring-rule changes never
 * rewrite history.
 */
export interface PointGrant {
  id: string;
  kind: 'grant';
  /** The completer (instance.completedBy) — who the points belong to. */
  userId: string;
  instanceId: string;
  definitionId: string;
  /** Task title snapshot, for display after the instance is gone. */
  title: string;
  /** The instance's face-value points at completion time. */
  faceValue: number;
  /** Awarded points (always >= 1). */
  points: number;
  timing: PointTiming;
  /** Whole calendar days past the due date (0 unless timing === 'late'). */
  daysLate: number;
  /** ISO timestamp of the completion (central clock). */
  completedAt: string;
}

/**
 * Append-only record cancelling a grant on reopen: references the exact
 * grant it voids and names the user the points were taken back from.
 * A grant plus its revocation cancel out everywhere.
 */
export interface PointRevocation {
  id: string;
  kind: 'revocation';
  /** The grant this revocation cancels. */
  grantId: string;
  /** Who the points were revoked from (the original completer). */
  userId: string;
  instanceId: string;
  /** Exact amount revoked — mirrors the grant. */
  points: number;
  /** ISO timestamp of the reopen (central clock). */
  reopenedAt: string;
}

export type PointEvent = PointGrant | PointRevocation;

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
