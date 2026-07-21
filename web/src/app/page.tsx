'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClockSpoofer } from '@/components/ClockSpoofer';
import { TaskCard } from '@/components/TaskCard';
import { useUser } from '@/context/UserContext';
import { getClock, listInstances, upcoming } from '@/lib/api';
import { addDaysStr, formatDateShort } from '@/lib/dates';
import type { ClockState, TaskInstance } from '@/lib/types';

interface Group {
  key: string;
  label: string;
  overdue: boolean;
  items: TaskInstance[];
}

export default function DashboardPage() {
  const { me, loading: userLoading, switchUser } = useUser();
  const [clock, setClock] = useState<ClockState | null>(null);
  const [pending, setPending] = useState<TaskInstance[]>([]);
  const [completed, setCompleted] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      // The server's (possibly spoofed) "today" is the reference for grouping,
      // so ClockSpoofer scenarios render exactly as the server sees them.
      const clk = await getClock();
      const [mine, done] = await Promise.all([
        upcoming(me.id, 7),
        listInstances({ status: 'completed', from: addDaysStr(clk.today, -7), to: addDaysStr(clk.today, 7) }),
      ]);
      setClock(clk);
      setPending(mine);
      setCompleted(done);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; state updates happen after awaits
    void load();
  }, [load]);

  const groups = useMemo<Group[]>(() => {
    if (!clock) return [];
    const ref = clock.today;
    const tomorrow = addDaysStr(ref, 1);
    const byKey = new Map<string, TaskInstance[]>();
    for (const t of [...pending, ...completed]) {
      const key = t.dueDate < ref ? 'overdue' : t.dueDate;
      const list = byKey.get(key);
      if (list) list.push(t);
      else byKey.set(key, [t]);
    }
    return [...byKey.keys()]
      .sort((a, b) => (a === 'overdue' ? -1 : b === 'overdue' ? 1 : a < b ? -1 : 1))
      .map((key) => ({
        key,
        overdue: key === 'overdue',
        label:
          key === 'overdue'
            ? 'Overdue'
            : key === ref
              ? 'Today'
              : key === tomorrow
                ? 'Tomorrow'
                : formatDateShort(key),
        items: byKey
          .get(key)!
          .sort((a, b) =>
            a.status === b.status ? a.title.localeCompare(b.title) : a.status === 'pending' ? -1 : 1,
          ),
      }));
  }, [pending, completed, clock]);

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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Household Tasks</h1>
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
          <Link
            href="/tasks/new"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + New task
          </Link>
        </div>
      </header>

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
        ) : groups.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-center text-neutral-500">
            Nothing due in the next 7 days. 🎉
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <h2 className={`text-sm font-semibold ${g.overdue ? 'text-red-600' : 'text-neutral-700'}`}>
                {g.label}
                <span className="ml-2 font-normal text-neutral-400">{g.items.length}</span>
              </h2>
              <ul className="mt-2 space-y-2">
                {g.items.map((t) => (
                  <TaskCard key={t.id} instance={t} overdue={g.overdue} onChanged={() => void load()} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <ClockSpoofer clock={clock} onChanged={() => void load()} />
    </main>
  );
}
