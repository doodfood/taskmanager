import type { StorageProvider } from './storage/StorageProvider.js';
import { createBadgeService } from './services/badgeService.js';
import { hydrateAll } from './services/hydrationService.js';

/**
 * Runs the hydration loop: once immediately at boot, then every intervalMs
 * (default 60 minutes). After hydration, the badge rollover detects whether
 * a Monday boundary has passed and awards the finished week's badges (D3).
 * Returns a stop function.
 */
export function startScheduler(
  storage: StorageProvider,
  intervalMs: number,
  horizonDays: number,
  log: (msg: string) => void = console.log,
): () => void {
  const badges = createBadgeService(storage);
  const run = async () => {
    try {
      const { created } = await hydrateAll(storage, horizonDays);
      log(`[scheduler] hydration complete — ${created} instance(s) created`);
      const rollover = await badges.rolloverIfNewWeek();
      if (rollover.initialised) {
        log('[scheduler] badge rollover initialised (epoch set; no awards on first run)');
      } else if (rollover.awarded > 0) {
        log(`[scheduler] badge rollover awarded ${rollover.awarded} badge(s) for week ${rollover.awardedWeekStart}`);
      }
    } catch (err) {
      console.error('[scheduler] hydration failed:', err);
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
