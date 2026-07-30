import type { BadgeTier } from '../types.js';

/** How a badge interprets its numeric value (display formatting is a UI concern). */
export type ValueKind = 'none' | 'job-count' | 'streak-weeks';

/**
 * One week's badge-relevant data for a user, computed by the engine relative
 * to the as-of date. Two bucketing schemes share the slice (plan "Edge
 * cases"): completion counts bucket jobs by the week containing the
 * completedAt local date; streak flags bucket jobs by the week containing
 * their dueDate.
 */
export interface WeekSlice {
  /** yyyy-MM-dd (Monday) of the week this slice covers. */
  weekStart: string;
  /** Completions credited to the user (completedBy) with completion local date in this week. */
  earlyCount: number; // completion date < occurrenceDate
  inWindowCount: number; // occurrenceDate <= completion date <= dueDate
  lateCount: number; // completion date > dueDate
  /** Auto-assigned jobs (assignmentKind 'auto', D8) with dueDate in this week. */
  autoAssignedDue: number;
  /**
   * No auto-assigned job due this week was late (completed after its due
   * date) or unfinished with its due date reached by the as-of date.
   * Vacuously true for empty weeks (Q7).
   */
  clean: boolean;
  /**
   * Every auto-assigned job due this week was completed early. A pending job
   * breaks this as soon as its occurrence date arrives (it can no longer be
   * early). Vacuously true for empty weeks (Q7).
   */
  allEarly: boolean;
}

/**
 * Everything badge rules need, derived purely from (userId, asOfDate,
 * instances, epoch). Categories never do their own I/O (plan D4).
 *
 * The as-of date is inclusive: evaluation is "at the end of day asOfDate".
 * A pending auto-assigned job therefore breaks `clean` once its dueDate is
 * on or before the as-of date — so the live view flags a streak at risk for
 * jobs due today (it self-heals on completion), and the Monday award
 * ceremony (as-of = last Sunday) correctly counts jobs left undone at
 * week's end.
 */
export interface EvaluationContext {
  userId: string;
  /** yyyy-MM-dd — the date being evaluated (inclusive). */
  asOfDate: string;
  /** yyyy-MM-dd (Monday) — completions before this week do not exist for the engine (Q11). */
  epoch: string;
  /** The week containing the as-of date (zeroed if that week predates the epoch). */
  currentWeek: WeekSlice;
  /** Weeks before currentWeek, newest first, clipped at the epoch. */
  pastWeeks: WeekSlice[];
  /** Consecutive clean weeks counting back from the current week (included), clipped at the epoch. */
  cleanStreak: number;
  /** Consecutive all-early weeks counting back from the current week (included), clipped at the epoch. */
  allEarlyStreak: number;
}

/** A badge the user currently qualifies for, with its value at evaluation time. */
export interface EarnedBadge {
  badgeId: string;
  categoryId: string;
  tier: BadgeTier;
  /** job count or streak length per valueKind; null when valueKind is 'none'. */
  value: number | null;
}

export interface BadgeDefinition {
  /** Stable string id — awards reference it forever; renaming orphans history. */
  id: string;
  tier: BadgeTier;
  /** Decides the single earned badge within a category (D5): highest number wins. */
  priority: number;
  valueKind: ValueKind;
  /** Optional display-name override; the category name is used when absent. */
  name?: string;
  description: string;
  /** Returns the badge's value when it is earned this week, null otherwise. */
  evaluate: (ctx: EvaluationContext) => { value: number } | null;
}

export interface BadgeCategory {
  id: string;
  name: string;
  description: string;
  badges: BadgeDefinition[];
}
