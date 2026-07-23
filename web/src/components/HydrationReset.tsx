'use client';

import { useState } from 'react';
import { clearInstances, resetWatermarks } from '@/lib/api';

interface HydrationResetProps {
  /** Called after a reset so the parent refetches tasks + clock. */
  onChanged: () => void;
}

/**
 * Dev tool for scenario testing: wipe hydrated task instances and/or reset the
 * hydration watermarks (lastHydratedDate) on every definition. Clearing both,
 * then jumping the clock, rehydrates a clean slate — so you can step the
 * server clock backwards and forwards and test the full hydration flow.
 */
export function HydrationReset({ onChanged }: HydrationResetProps) {
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

  const clear = () =>
    void run(async () => {
      const res = await clearInstances();
      return `Cleared ${res.cleared} hydrated task(s)`;
    });

  const reset = () =>
    void run(async () => {
      const res = await resetWatermarks();
      return `Reset hydration watermark on ${res.reset} definition(s)`;
    });

  const resetAll = () =>
    void run(async () => {
      const cleared = await clearInstances();
      const watermarks = await resetWatermarks();
      return `Clean slate — cleared ${cleared.cleared} task(s), reset ${watermarks.reset} watermark(s). Jump the clock to rehydrate.`;
    });

  return (
    <section className="mt-8 rounded-lg border border-dashed border-neutral-300 bg-neutral-100 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Dev tools — hydration reset</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Wipe hydrated tasks and reset definition watermarks, then use the clock spoofer to rehydrate at any date.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={clear}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Clear hydrated tasks
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={reset}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-200 disabled:opacity-50"
        >
          Reset watermarks
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={resetAll}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Clear + reset (clean slate)
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
