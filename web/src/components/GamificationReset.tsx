'use client';

import { useState } from 'react';
import { clearBadgeAwards, clearPoints, resetBadgeState } from '@/lib/api';
import { formatDateShort } from '@/lib/dates';

interface GamificationResetProps {
  /** Called after a reset so the parent refetches tasks + clock. */
  onChanged: () => void;
}

/**
 * Dev tool for scenario testing: rewind the badge rollover watermark + epoch
 * to the Monday of the current server week (unsticks awards after a spoofed
 * clock jump ran a rollover in the future), or wipe the points ledger so
 * everyone's balance returns to zero.
 */
export function GamificationReset({ onChanged }: GamificationResetProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset action failed');
    } finally {
      setBusy(false);
    }
  }

  const resetBadges = () =>
    void run(async () => {
      const state = await resetBadgeState();
      return `Badge state rewound — epoch and week watermark now ${formatDateShort(state.badgesEpoch)}; the next Monday rollover awards the current week`;
    });

  const wipeBadges = () =>
    void run(async () => {
      const res = await clearBadgeAwards();
      return `Cleared ${res.cleared} awarded badge(s) — the permanent ledger is empty`;
    });

  const wipePoints = () =>
    void run(async () => {
      const res = await clearPoints();
      return `Cleared ${res.cleared} point event(s) and ${res.snapshotsCleared} task snapshot(s) — everyone's balance is back to 0`;
    });

  return (
    <section className="mt-8 rounded-lg border border-dashed border-neutral-300 bg-neutral-100 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Dev tools — gamification reset
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Rewind the badge week watermark + epoch to the Monday of this week, wipe the permanent badge award
        ledger, or wipe every point grant so balances return to zero.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={resetBadges}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Reset badge week to this Monday
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={wipeBadges}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Clear awarded badges
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={wipePoints}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Clear all points
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
