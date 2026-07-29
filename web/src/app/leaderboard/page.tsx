'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { getLeaderboard, type LeaderboardWeeks } from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/types';

/** Window tabs offered by the page (the only values the API accepts). */
const WEEK_OPTIONS: readonly LeaderboardWeeks[] = [1, 2, 4, 8];

/** Medal treatment for the top 3 ranks; everyone else gets a plain number. */
const MEDALS = ['🥇', '🥈', '🥉'] as const;

function windowLabel(weeks: LeaderboardWeeks): string {
  return weeks === 1 ? 'the last week' : `the last ${weeks} weeks`;
}

/**
 * Ranked household points over a rolling 1/2/4/8-week window. Every
 * registered user appears, even at 0; reopened completions count for nothing.
 * The signed-in user's row is highlighted so you can find yourself at a glance.
 */
export default function LeaderboardPage() {
  const { me, loading: userLoading } = useUser();
  const [weeks, setWeeks] = useState<LeaderboardWeeks>(1);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which window `entries` was fetched for. Differs from `weeks` while a tab
   * switch is in flight, so the stale table can dim instead of flashing a
   * spinner or showing the new label over old data.
   */
  const [loadedWeeks, setLoadedWeeks] = useState<LeaderboardWeeks | null>(null);
  const refreshing = !loading && loadedWeeks !== weeks;

  const load = useCallback(async (w: LeaderboardWeeks) => {
    try {
      const board = await getLeaderboard(w);
      setEntries(board);
      setLoadedWeeks(w);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount / tab change; state updates happen after awaits
    void load(weeks);
  }, [weeks, load]);

  if (userLoading || !me) {
    // No identity yet — UserContext is redirecting to /users.
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800">
        ← Back to overview
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Leaderboard</h1>
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1" role="group" aria-label="Time window">
          {WEEK_OPTIONS.map((w) => {
            const active = w === weeks;
            return (
              <button
                key={w}
                type="button"
                aria-pressed={active}
                onClick={() => setWeeks(w)}
                className={`rounded-md px-3 py-1 text-sm whitespace-nowrap transition-colors ${
                  active ? 'bg-indigo-600 font-medium text-white' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {w === 1 ? '1 week' : `${w} weeks`}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Points earned {windowLabel(weeks)} — finishing early earns a bonus, finishing late costs points, and reopened
        tasks count for nothing.
      </p>

      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load(weeks)}
            className="shrink-0 rounded-md border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-neutral-500">Loading leaderboard…</p>
      ) : entries.length === 0 && !error ? (
        <p className="mt-6 text-neutral-500">No household members yet.</p>
      ) : (
        <div className={refreshing ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
          <div className="mt-4 flex items-center gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            <span className="w-8 text-center">Rank</span>
            <span className="flex-1">Who</span>
            <span className="text-right">Tasks done</span>
            <span className="w-16 text-right">Points</span>
          </div>
          <ol className="mt-1 space-y-2">
            {entries.map((e) => {
              const isMe = e.user.id === me.id;
              return (
                <li
                  key={e.user.id}
                  aria-current={isMe || undefined}
                  className={`flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5 shadow-sm ${
                    isMe ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-neutral-200'
                  }`}
                >
                  <span className="w-8 shrink-0 text-center text-lg leading-none">
                    {e.rank <= MEDALS.length ? (
                      MEDALS[e.rank - 1]
                    ) : (
                      <span className="text-sm font-semibold text-neutral-400">{e.rank}</span>
                    )}
                  </span>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: e.user.color }} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {e.user.name}
                    {isMe && <span className="ml-2 text-xs font-normal text-indigo-600">you</span>}
                  </span>
                  <span className="shrink-0 text-right text-sm text-neutral-500">
                    {e.tasksCompleted} task{e.tasksCompleted === 1 ? '' : 's'}
                  </span>
                  <span className="w-16 shrink-0 text-right text-sm font-bold">{e.totalPoints} pts</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </main>
  );
}
