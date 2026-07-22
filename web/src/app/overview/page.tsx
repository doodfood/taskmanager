'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClockSpoofer } from '@/components/ClockSpoofer';
import { TaskCard } from '@/components/TaskCard';
import { useUser } from '@/context/UserContext';
import { getClock, listInstances } from '@/lib/api';
import { addDaysStr, formatDateShort } from '@/lib/dates';
import type { ClockState, TaskInstance } from '@/lib/types';

/** Assignee-group keys that can't collide with a user UUID. */
const ANYONE = '__anyone__';

/**
 * How far ahead (from the server's "today") the overview looks. Kept in step
 * with the server's hydration horizon (HYDRATION_HORIZON_DAYS, default 5) —
 * widening this beyond the horizon shows nothing extra for recurring tasks,
 * since their instances wouldn't have been materialised yet.
 */
const WINDOW_DAYS = 5;

interface UserGroup {
  key: string;
  name: string;
  /** null → grey dot (Anyone / Unknown). */
  color: string | null;
  items: TaskInstance[];
  overdueCount: number;
}

/**
 * Household-wide board: every pending instance (no assignee filter, completed
 * tasks excluded), grouped by person so each family member can spot — and
 * complete — their upcoming tasks.
 */
export default function OverviewPage() {
  const { me, users, loading: userLoading, switchUser } = useUser();
  const [clock, setClock] = useState<ClockState | null>(null);
  const [pending, setPending] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // The server's (possibly spoofed) "today" bounds the window, so
      // ClockSpoofer scenarios render exactly as the server sees them.
      const clk = await getClock();
      const items = await listInstances({ status: 'pending', to: addDaysStr(clk.today, WINDOW_DAYS) });
      setClock(clk);
      setPending(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; state updates happen after awaits
    void load();
  }, [load]);

  const groups = useMemo<UserGroup[]>(() => {
    if (!clock) return [];
    const ref = clock.today;
    const byAssignee = new Map<string, TaskInstance[]>();
    for (const t of pending) {
      const key = t.assigneeId ?? ANYONE;
      const list = byAssignee.get(key);
      if (list) list.push(t);
      else byAssignee.set(key, [t]);
    }

    const byDueThenTitle = (a: TaskInstance, b: TaskInstance) =>
      a.dueDate === b.dueDate ? a.title.localeCompare(b.title) : a.dueDate < b.dueDate ? -1 : 1;
    const make = (key: string, name: string, color: string | null, items: TaskInstance[]): UserGroup => ({
      key,
      name,
      color,
      items: [...items].sort(byDueThenTitle),
      overdueCount: items.filter((t) => t.dueDate < ref).length,
    });

    const result: UserGroup[] = [];
    // The communal pool first — unassigned tasks still need an owner.
    const anyone = byAssignee.get(ANYONE);
    if (anyone) result.push(make(ANYONE, 'Anyone', null, anyone));
    // Every household member, even with an empty list, so each person can see
    // at a glance that they have nothing due.
    for (const u of users) {
      result.push(make(u.id, u.name, u.color, byAssignee.get(u.id) ?? []));
      byAssignee.delete(u.id);
    }
    byAssignee.delete(ANYONE);
    // Surface tasks whose assignee was deleted rather than dropping them.
    for (const [key, items] of byAssignee) {
      result.push(make(key, 'Unknown', null, items));
    }
    return result;
  }, [pending, users, clock]);

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
        ← Back to dashboard
      </Link>
      <header className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Household overview</h1>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: me.color }} />
            {me.name}
          </span>
          <button
            type="button"
            onClick={switchUser}
            className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
          >
            switch
          </button>
        </div>
      </header>
      <p className="mt-1 text-sm text-neutral-500">
        Everyone&rsquo;s pending tasks — anything overdue plus everything due in the next {WINDOW_DAYS} days — grouped
        by person. Completed tasks are hidden; completing here records <strong>{me.name}</strong> as the doer.
      </p>

      {clock?.spoofed && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Clock is spoofed — the server thinks today is <strong>{formatDateShort(clock.today)}</strong>. Reset it from
          the dev tools below.
        </div>
      )}

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

      <div className="mt-6 space-y-6">
        {loading ? (
          <p className="text-neutral-500">Loading tasks…</p>
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: g.color ?? '#a3a3a3' }}
                />
                {g.name}
                <span className="font-normal text-neutral-400">{g.items.length}</span>
                {g.overdueCount > 0 && <span className="font-semibold text-red-600">{g.overdueCount} overdue</span>}
              </h2>
              {g.items.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-400">Nothing due 🎉</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {g.items.map((t) => (
                    <TaskCard
                      key={t.id}
                      instance={t}
                      overdue={clock !== null && t.dueDate < clock.today}
                      onChanged={() => void load()}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>

      <ClockSpoofer clock={clock} onChanged={() => void load()} />
    </main>
  );
}
