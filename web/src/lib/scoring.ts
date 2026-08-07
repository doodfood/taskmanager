/**
 * Client-side preview of the server's completion award. Keep these values in
 * sync with server/src/scoring.ts; this is only used to show pending cards what
 * they would earn if completed on the server's current date.
 */
const EARLY_BONUS = 5;
const LATE_PENALTY_PER_DAY = 1;
const MIN_AWARD = 1;

function dateValue(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Calculate the points a task would award if completed on `completionDate`. */
export function pointsForCompletionToday(
  faceValue: number,
  occurrenceDate: string,
  dueDate: string,
  completionDate: string,
): number {
  const daysLate = Math.round((dateValue(completionDate) - dateValue(dueDate)) / 86_400_000);
  if (completionDate < occurrenceDate) return Math.max(MIN_AWARD, faceValue + EARLY_BONUS);
  if (daysLate <= 0) return Math.max(MIN_AWARD, faceValue);
  return Math.max(MIN_AWARD, faceValue - daysLate * LATE_PENALTY_PER_DAY);
}
