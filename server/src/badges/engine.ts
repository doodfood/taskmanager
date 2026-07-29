import { addWeeks, format, parseISO, startOfWeek } from 'date-fns';
import type { TaskInstance } from '../types.js';
import { badgeCategories } from './index.js';
import type { BadgeCategory, BadgeDefinition, EarnedBadge, EvaluationContext, WeekSlice } from './types.js';

/** yyyy-MM-dd of the Monday of the week containing the given yyyy-MM-dd date (server-local). */
export function mondayOf(dateStr: string): string {
  return format(startOfWeek(parseISO(dateStr), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** The local (server timezone) yyyy-MM-dd date of an ISO timestamp. */
export function localDateOf(isoTimestamp: string): string {
  return format(parseISO(isoTimestamp), 'yyyy-MM-dd');
}

function emptySlice(weekStart: string): WeekSlice {
  return { weekStart, earlyCount: 0, inWindowCount: 0, lateCount: 0, autoAssignedDue: 0, clean: true, allEarly: true };
}

function zeroContext(userId: string, asOfDate: string, epoch: string): EvaluationContext {
  return {
    userId,
    asOfDate,
    epoch,
    currentWeek: emptySlice(mondayOf(asOfDate)),
    pastWeeks: [],
    cleanStreak: 0,
    allEarlyStreak: 0,
  };
}

/**
 * Fold the instance history into per-week slices for the user, from the week
 * containing the as-of date back to the epoch (clipped — pre-epoch weeks and
 * completions do not exist for the engine, Q11). Pure; no I/O, no clock
 * reads (D4).
 */
export function buildEvaluationContext(
  userId: string,
  asOfDate: string,
  instances: TaskInstance[],
  epoch: string,
): EvaluationContext {
  const currentMonday = mondayOf(asOfDate);
  const epochMonday = mondayOf(epoch);
  if (currentMonday < epochMonday) return zeroContext(userId, asOfDate, epoch);

  // Current week first, then walking back to (and including) the epoch week.
  const slices = new Map<string, WeekSlice>();
  for (let cursor = currentMonday; cursor >= epochMonday; cursor = format(addWeeks(parseISO(cursor), -1), 'yyyy-MM-dd')) {
    slices.set(cursor, emptySlice(cursor));
  }

  for (const instance of instances) {
    // ---- Completion credit (D7 strict partition), credited to the completer,
    // bucketed by the week containing the completedAt local date.
    if (instance.status === 'completed' && instance.completedBy === userId && instance.completedAt) {
      const completedDate = localDateOf(instance.completedAt);
      if (completedDate <= asOfDate) {
        const slice = slices.get(mondayOf(completedDate));
        if (slice) {
          if (completedDate < instance.occurrenceDate) slice.earlyCount++;
          else if (completedDate <= instance.dueDate) slice.inWindowCount++;
          else slice.lateCount++;
        }
      }
    }

    // ---- Streak risk (D8): only auto-assigned jobs punish, bucketed by the
    // week containing their dueDate. Completion state matters, not who
    // completed it (helping with someone's job still saves their streak).
    if (instance.assignmentKind === 'auto' && instance.assigneeId === userId) {
      const slice = slices.get(mondayOf(instance.dueDate));
      if (slice) {
        slice.autoAssignedDue++;
        if (instance.status === 'completed' && instance.completedAt) {
          const completedDate = localDateOf(instance.completedAt);
          if (completedDate > instance.dueDate) slice.clean = false; // late
          if (completedDate >= instance.occurrenceDate) slice.allEarly = false; // not early
        } else {
          // Pending: overdue/unfinished once the due date is reached (as-of is
          // inclusive); can no longer be completed early once the start date is.
          if (instance.dueDate <= asOfDate) slice.clean = false;
          if (instance.occurrenceDate <= asOfDate) slice.allEarly = false;
        }
      }
    }
  }

  const weeks = [...slices.values()]; // insertion order: current week first, then back to epoch
  const [currentWeek, ...pastWeeks] = weeks;

  const streakFrom = (flag: 'clean' | 'allEarly'): number => {
    let streak = 0;
    for (const week of weeks) {
      if (!week[flag]) break;
      streak++;
    }
    return streak;
  };

  return {
    userId,
    asOfDate,
    epoch,
    currentWeek,
    pastWeeks,
    cleanStreak: streakFrom('clean'),
    allEarlyStreak: streakFrom('allEarly'),
  };
}

const TIER_RANK: Record<string, number> = { bronze: 1, silver: 2, gold: 3 };

/**
 * One earned badge per category per week (D5): among the qualifying badges,
 * the highest priority number wins; ties break towards the higher tier
 * (gold > silver > bronze).
 */
function selectEarned(category: BadgeCategory, ctx: EvaluationContext): EarnedBadge | null {
  let winner: { badge: BadgeDefinition; value: number } | null = null;
  for (const badge of category.badges) {
    const result = badge.evaluate(ctx);
    if (result === null) continue;
    if (
      winner === null ||
      badge.priority > winner.badge.priority ||
      (badge.priority === winner.badge.priority && TIER_RANK[badge.tier] > TIER_RANK[winner.badge.tier])
    ) {
      winner = { badge, value: result.value };
    }
  }
  if (winner === null) return null;
  return {
    badgeId: winner.badge.id,
    categoryId: category.id,
    tier: winner.badge.tier,
    value: winner.badge.valueKind === 'none' ? null : winner.value,
  };
}

/**
 * The badges the user currently qualifies for, one per category (D5). Pure
 * function of (user, as-of date, instance history, epoch) — the same call
 * serves the live "pending award" view (as-of = today) and the Monday award
 * ceremony (as-of = last Sunday) (D4).
 */
export function evaluateBadges(
  userId: string,
  asOfDate: string,
  instances: TaskInstance[],
  epoch: string,
): EarnedBadge[] {
  const ctx = buildEvaluationContext(userId, asOfDate, instances, epoch);
  return badgeCategories
    .map((category) => selectEarned(category, ctx))
    .filter((earned): earned is EarnedBadge => earned !== null);
}
