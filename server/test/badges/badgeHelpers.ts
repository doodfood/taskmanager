import type { TaskInstance } from '../../src/types.js';
import { evaluateBadges } from '../../src/badges/engine.js';
import type { EarnedBadge } from '../../src/badges/types.js';

/**
 * Shared fixtures for badge engine tests. All dates are local date strings;
 * completedAt timestamps are offset-less ISO (parsed as server-local time)
 * so tests are timezone-independent.
 *
 * Week anchors (Monday-anchored, server-local):
 *   W0 = 2026-07-20 … 2026-07-26   W1 = 2026-07-27 … 2026-08-02
 *   W2 = 2026-08-03 … 2026-08-09   W3 = 2026-08-10 … 2026-08-16
 *   W4 = 2026-08-17 … 2026-08-23   W5 = 2026-08-24 …
 */
export const W = ['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'] as const;

/** Default epoch: the W0 Monday. */
export const EPOCH = W[0];

export const ALICE = 'user-alice';
export const BOB = 'user-bob';

let seq = 0;

/** A pending, auto-assigned instance by default; override anything. */
export function makeInstance(overrides: Partial<TaskInstance> = {}): TaskInstance {
  seq++;
  return {
    id: `inst-${seq}`,
    definitionId: 'def-1',
    title: `Job ${seq}`,
    description: '',
    assigneeId: ALICE,
    assignmentKind: 'auto',
    points: 10,
    occurrenceDate: '2026-07-20',
    dueDate: '2026-07-22',
    status: 'pending',
    completedBy: null,
    completedAt: null,
    pointsAwarded: null,
    createdAt: '2026-07-20T09:00:00',
    ...overrides,
  };
}

/** Patch marking an instance completed by `userId` on local date `date`. */
export function completedOn(userId: string, date: string, time = '10:00'): Partial<TaskInstance> {
  return {
    status: 'completed',
    completedBy: userId,
    completedAt: `${date}T${time}:00`,
    pointsAwarded: 10,
  };
}

/** Evaluate the full engine and return every earned badge. */
export function evaluate(
  userId: string,
  asOfDate: string,
  instances: TaskInstance[],
  epoch: string = EPOCH,
): EarnedBadge[] {
  return evaluateBadges(userId, asOfDate, instances, epoch);
}

/** Evaluate and return just the earned badge ids. */
export function earnedIds(userId: string, asOfDate: string, instances: TaskInstance[], epoch?: string): string[] {
  return evaluate(userId, asOfDate, instances, epoch).map((b) => b.badgeId);
}

/** Evaluate and return the earned badge from one category (or null). */
export function earnedInCategory(
  userId: string,
  asOfDate: string,
  instances: TaskInstance[],
  categoryId: string,
  epoch?: string,
): EarnedBadge | null {
  return evaluate(userId, asOfDate, instances, epoch).find((b) => b.categoryId === categoryId) ?? null;
}
