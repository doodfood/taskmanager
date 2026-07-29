import { format, parseISO } from 'date-fns';
import { addDaysStr, todayStr } from '../clock.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { badRequest, type PointGrant, type PointRevocation, type User } from '../types.js';

/** The rolling-window sizes (in weeks) the leaderboard supports. */
export const LEADERBOARD_WEEKS = [1, 2, 4, 8] as const;
export type LeaderboardWeeks = (typeof LEADERBOARD_WEEKS)[number];

/** One ranked row of the leaderboard. */
export interface LeaderboardEntry {
  user: User;
  /** Net points from un-revoked grants completed inside the window. */
  totalPoints: number;
  /** Un-revoked completions inside the window. */
  tasksCompleted: number;
  /** 1-based position after sorting (points desc, name asc). */
  rank: number;
}

/**
 * Reads the points ledger and ranks every registered user over a rolling
 * window. Writing the ledger (grants/revocations) is pointsService's job.
 *
 * Window definition: the N·7 calendar days ending today (server-local dates,
 * via the central clock so spoofed dates work). An entry exactly N weeks ago
 * falls outside; the window always includes today. Revoked grants count for
 * nothing — neither points nor the tasks-completed tally — in every window.
 */
export function createLeaderboardService(storage: StorageProvider) {
  async function leaderboard(weeks: number): Promise<LeaderboardEntry[]> {
    if (!LEADERBOARD_WEEKS.includes(weeks as LeaderboardWeeks)) {
      throw badRequest(`weeks must be one of ${LEADERBOARD_WEEKS.join(', ')}`);
    }
    // Local yyyy-MM-dd of the oldest in-window day (today − (N·7 − 1) days).
    const windowStart = addDaysStr(todayStr(), -(weeks * 7 - 1));

    const events = await storage.listPointEvents();
    const revokedIds = new Set(
      events.filter((e): e is PointRevocation => e.kind === 'revocation').map((e) => e.grantId),
    );
    const inWindow = events.filter(
      (e): e is PointGrant =>
        e.kind === 'grant' && !revokedIds.has(e.id) && format(parseISO(e.completedAt), 'yyyy-MM-dd') >= windowStart,
    );

    const points = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const g of inWindow) {
      points.set(g.userId, (points.get(g.userId) ?? 0) + g.points);
      counts.set(g.userId, (counts.get(g.userId) ?? 0) + 1);
    }

    // Every registered user appears, even with 0 points — it's a leaderboard,
    // not just a winners list. Deleted users simply drop off (their ledger
    // history is harmless). Ties break alphabetically for a stable order.
    const users = await storage.listUsers();
    return users
      .map((user) => ({
        user,
        totalPoints: points.get(user.id) ?? 0,
        tasksCompleted: counts.get(user.id) ?? 0,
        rank: 0,
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints || a.user.name.localeCompare(b.user.name))
      .map((entry, i) => ({ ...entry, rank: i + 1 }));
  }

  return { leaderboard };
}

export type LeaderboardService = ReturnType<typeof createLeaderboardService>;
