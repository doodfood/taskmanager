import type { StorageProvider } from './storage/StorageProvider.js';
import { hydrateAll } from './services/hydrationService.js';

/**
 * Runs the hydration loop: once immediately at boot, then every intervalMs
 * (default 60 minutes). Returns a stop function.
 */
export function startScheduler(
  storage: StorageProvider,
  intervalMs: number,
  horizonDays: number,
  log: (msg: string) => void = console.log,
): () => void {
  const run = async () => {
    try {
      const { created } = await hydrateAll(storage, horizonDays);
      log(`[scheduler] hydration complete — ${created} instance(s) created`);
    } catch (err) {
      console.error('[scheduler] hydration failed:', err);
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
