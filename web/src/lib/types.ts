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
   * Difficulty estimate (0–100, default 10); summed to balance auto-assignment
   * across users. Doubles as the face value for points scoring on completion.
   */
  points: number;
  /** Users hydrated instances may be auto-assigned to (least busy wins); empty = instances go to "anyone". */
  autoAssignableTo: string[];
  /** due N days after each occurrence date */
  dueOffsetDays: number;
  /** yyyy-MM-dd of the first occurrence; null = anchored on the creation date */
  startDate: string | null;
  active: boolean;
  lastHydratedDate: string | null;
  createdAt: string; // ISO timestamp
}

/** How the current assignee got the job (drives badge streak immunity). */
export type AssignmentKind = 'auto' | 'manual' | 'none';

/** A concrete, actionable task materialised from a definition. */
export interface TaskInstance {
  id: string;
  definitionId: string;
  title: string;
  description: string;
  /** null = anyone can do it */
  assigneeId: string | null;
  /** How the current assignee got the job: auto at hydration, manual via reassign, none = anyone. */
  assignmentKind: AssignmentKind;
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
   * adjustment applied). null/absent = no award: pending, or completed before
   * gamification shipped. The points ledger remains the authoritative record.
   */
  pointsAwarded: number | null;
  createdAt: string; // ISO timestamp
}

// ---------- Points ledger (mirrors server/src/types.ts) ----------

/** How the completion date compared to the due date, for display. */
export type PointTiming = 'early' | 'on-time' | 'late';

/** Append-only record of a completion award (snapshotted at completion time). */
export interface PointGrant {
  id: string;
  kind: 'grant';
  /** The completer — who the points belong to. */
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
  /** ISO timestamp of the completion. */
  completedAt: string;
}

/** Append-only record cancelling a grant on reopen. */
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
  /** ISO timestamp of the reopen. */
  reopenedAt: string;
}

export type PointEvent = PointGrant | PointRevocation;

// ---------- Leaderboard (mirrors server/src/services/leaderboardService.ts) ----------

/** One ranked row of GET /api/leaderboard?weeks=1|2|4|8. */
export interface LeaderboardEntry {
  user: User;
  /** Net points from un-revoked grants completed inside the window. */
  totalPoints: number;
  /** Un-revoked completions inside the window. */
  tasksCompleted: number;
  /** 1-based position after sorting (points desc, name asc). */
  rank: number;
}

/** Shape returned by GET /api/debug/clock (POST adds `hydrated`). */
export interface ClockState {
  spoofed: boolean;
  spoofedDate: string | null;
  now: string; // ISO timestamp
  today: string; // yyyy-MM-dd — the server's effective "today"
}
