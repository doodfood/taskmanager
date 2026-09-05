'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { getClockSafe, getUserBadges, listUsers } from '@/lib/api';
import { addDaysStr, formatDateShort, mondayOf, toDateStr } from '@/lib/dates';
import type { AwardedBadge, BadgeTier, EarnedBadge, User, UserBadges } from '@/lib/types';

const TIER_MEDAL: Record<BadgeTier, string> = { bronze: '🥉', silver: '🥈', gold: '🥇' };

/**
 * Award-cycle window options. A cycle is one Monday rollover: "last cycle" is
 * the week that most recently finished, "last 2 cycles" that week plus the one
 * before it, and so on. 'all' shows the full permanent ledger.
 */
const CYCLE_OPTIONS = [
  { value: '1', label: 'Last cycle' },
  { value: '2', label: 'Last 2 cycles' },
  { value: '3', label: 'Last 3 cycles' },
  { value: '4', label: 'Last 4 cycles' },
  { value: 'all', label: 'All cycles' },
] as const;

type CycleFilter = (typeof CYCLE_OPTIONS)[number]['value'];

interface UserBadgeRow {
  user: User;
  badges: UserBadges;
}

/**
 * Household badge board: everyone on one screen. "Awarded" badges are the
 * permanent record written at each Monday rollover; "on track" badges are the
 * live evaluation for the current week — they only become permanent if the
 * user still qualifies when the next Monday rollover runs. Loading this page
 * reads the badge API, which triggers that rollover lazily server-side.
 */
export default function BadgesPage() {
  const { me, loading: userLoading } = useUser();
  const [rows, setRows] = useState<UserBadgeRow[]>([]);
  // The server clock is authoritative for cycle windows (it may be spoofed in
  // dev); fall back to the local date until the first load lands.
  const [today, setToday] = useState(() => toDateStr(new Date()));
  const [cycleFilter, setCycleFilter] = useState<CycleFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [clock, users] = await Promise.all([getClockSafe(), listUsers()]);
      const badges = await Promise.all(users.map((u) => getUserBadges(u.id)));
      setRows(users.map((user, i) => ({ user, badges: badges[i] })));
      setToday(clock.today);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load badges');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount; state updates happen after awaits
    void load();
  }, [load]);

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
        <h1 className="text-xl font-bold">Badges</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="cycle-filter" className="text-sm text-neutral-500">
            Awarded
          </label>
          <select
            id="cycle-filter"
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value as CycleFilter)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-700"
          >
            {CYCLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Awarded badges are permanent — written at each Monday rollover for the week that just finished. On-track
        badges are live for the current week and only become permanent if they still hold at the next rollover. Hover
        a badge to see how it is earned.
      </p>

      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 rounded-md border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-neutral-500">Loading badges…</p>
      ) : rows.length === 0 && !error ? (
        <p className="mt-6 text-neutral-500">No household members yet.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {rows.map(({ user, badges }) => (
            <section key={user.id} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: user.color }} />
                {user.name}
                {user.id === me.id && <span className="text-xs font-normal text-indigo-600">you</span>}
              </h2>
              <AwardedList awarded={badges.awarded} filter={cycleFilter} today={today} />
              <EarnedList earned={badges.earned} />
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

/** Badge name with the rule description in a hover (or keyboard-focus) tooltip. */
function BadgeName({ name, description }: { name: string; description: string }) {
  return (
    <span
      tabIndex={0}
      className="group relative cursor-help underline decoration-dotted decoration-neutral-300 underline-offset-2 outline-none"
    >
      {name}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-64 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-normal leading-snug text-white no-underline shadow-lg group-hover:block group-focus-within:block"
      >
        {description}
      </span>
    </span>
  );
}

/** The permanent award ledger, newest week first, windowed by the cycle filter. */
function AwardedList({ awarded, filter, today }: { awarded: AwardedBadge[]; filter: CycleFilter; today: string }) {
  // Awards are only ever written for finished weeks (weekStart is the Monday
  // of the week the badge was earned in), so a lower bound on weekStart
  // selects exactly the last N completed cycles.
  const cutoff = filter === 'all' ? null : addDaysStr(mondayOf(today), -7 * Number(filter));
  const visible = cutoff === null ? awarded : awarded.filter((award) => award.weekStart >= cutoff);

  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Awarded
        <span className="ml-1.5 font-normal normal-case text-neutral-400">
          {visible.length === awarded.length ? awarded.length : `${visible.length} of ${awarded.length}`}
        </span>
        {cutoff !== null && (
          <span className="ml-1.5 font-normal normal-case text-neutral-400">· since {formatDateShort(cutoff)}</span>
        )}
      </h3>
      {awarded.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">Nothing awarded yet.</p>
      ) : visible.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">Nothing awarded in this window.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {[...visible]
            .sort((a, b) => (a.weekStart === b.weekStart ? 0 : a.weekStart < b.weekStart ? 1 : -1))
            .map((award) => (
              <li key={award.id} className="flex items-baseline gap-2 text-sm">
                <span aria-hidden>{award.badge ? TIER_MEDAL[award.badge.tier] : '🎖️'}</span>
                <span className="min-w-0 flex-1 text-neutral-800">
                  {award.badge ? (
                    <BadgeName name={award.badge.name} description={award.badge.description} />
                  ) : (
                    award.badgeId
                  )}
                  {award.value !== null && <span className="ml-1.5 font-semibold text-neutral-500">×{award.value}</span>}
                </span>
                <span className="shrink-0 text-xs text-neutral-400">week of {formatDateShort(award.weekStart)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/** Live "on track" evaluation for the current week — greyed, not yet permanent. */
function EarnedList({ earned }: { earned: EarnedBadge[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        On track this week
        <span className="ml-1.5 font-normal normal-case text-neutral-400">{earned.length}</span>
      </h3>
      {earned.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">Nothing on track this week.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {earned.map((badge) => (
            // Dim via colour, not row opacity, so the hover tooltip stays fully opaque.
            <li key={badge.badgeId} className="flex items-baseline gap-2 text-sm">
              <span aria-hidden className="opacity-60">
                {TIER_MEDAL[badge.tier]}
              </span>
              <span className="min-w-0 flex-1 text-neutral-500">
                <BadgeName name={badge.name} description={badge.description} />
                {badge.value !== null && <span className="ml-1.5 font-semibold text-neutral-400">×{badge.value}</span>}
              </span>
              <span className="shrink-0 text-xs text-neutral-400">pending</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
