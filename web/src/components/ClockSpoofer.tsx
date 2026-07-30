'use client';

import { useState } from 'react';
import { resetClock, setClock } from '@/lib/api';
import { formatDateShort } from '@/lib/dates';
import type { ClockState } from '@/lib/types';

interface ClockSpooferProps {
  /** Latest clock state (owned by the parent so banner and spoofer stay in sync). */
  clock: ClockState | null;
  /** Called after a jump/reset so the parent refetches tasks + clock. */
  onChanged: () => void;
}

/**
 * Dev tool for scenario testing: jump the server clock to a date (re-runs
 * hydration server-side, so recurring tasks materialise) or reset to real time.
 */
export function ClockSpoofer({ clock, onChanged }: ClockSpooferProps) {
  const [date, setDate] = useState('');
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
      setError(err instanceof Error ? err.message : 'Clock action failed');
    } finally {
      setBusy(false);
    }
  }

  const jump = () =>
    void run(async () => {
      const res = await setClock(date);
      let msg = `Jumped to ${formatDateShort(res.today)} — hydrated ${res.hydrated ?? 0} new occurrence(s)`;
      if (res.rollover && res.rollover.awarded > 0) {
        msg += `; awarded ${res.rollover.awarded} badge(s) for week of ${formatDateShort(res.rollover.awardedWeekStart ?? '')}`;
      }
      return msg;
    });

  const reset = () =>
    void run(async () => {
      await resetClock();
      return 'Back to real time';
    });

  return (
    <section className="mt-8 rounded-lg border border-dashed border-neutral-300 bg-neutral-100 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Dev tools — clock spoofer</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Server today:{' '}
        <strong className={clock?.spoofed ? 'text-amber-700' : 'text-neutral-800'}>
          {clock ? formatDateShort(clock.today) : '…'}
        </strong>{' '}
        {clock && (clock.spoofed ? '(spoofed)' : '(real time)')}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={busy || !date}
          onClick={jump}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Jump
        </button>
        <button
          type="button"
          disabled={busy || !clock?.spoofed}
          onClick={reset}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-200 disabled:opacity-50"
        >
          Reset
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
