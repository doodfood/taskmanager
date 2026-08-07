import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { PointTiming } from './types.js';

/** Flat bonus for completing before the due date (does not scale with earliness). */
export const EARLY_BONUS = 5;
/** Penalty per whole calendar day past the due date. */
export const LATE_PENALTY_PER_DAY = 1;
/** Every completion grants at least this much, whatever the arithmetic says. */
export const MIN_AWARD = 1;

export interface Award {
  /** Points granted (always >= MIN_AWARD). */
  points: number;
  timing: PointTiming;
  /** Whole calendar days past the due date (0 unless timing === 'late'). */
  daysLate: number;
}

/**
 * The scoring rule, pure: derive the award from a task's face value and how
 * the completion date compares to the occurrence and due dates (yyyy-MM-dd).
 *
 * - before the occurrence/start date: face value + EARLY_BONUS
 * - on or after the occurrence date through the due date: face value
 * - overdue: face value − LATE_PENALTY_PER_DAY per calendar day late
 * - always: floored at MIN_AWARD
 */
export function computeAward(
  faceValue: number,
  occurrenceDate: string,
  dueDate: string,
  completionDate: string,
): Award {
  const lateBy = differenceInCalendarDays(parseISO(completionDate), parseISO(dueDate));
  if (completionDate < occurrenceDate) {
    return { points: Math.max(MIN_AWARD, faceValue + EARLY_BONUS), timing: 'early', daysLate: 0 };
  }
  if (lateBy <= 0) {
    return { points: Math.max(MIN_AWARD, faceValue), timing: 'on-time', daysLate: 0 };
  }
  return { points: Math.max(MIN_AWARD, faceValue - lateBy * LATE_PENALTY_PER_DAY), timing: 'late', daysLate: lateBy };
}
