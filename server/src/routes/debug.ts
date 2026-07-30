import { Router, type Request, type Response, type NextFunction } from 'express';
import { mondayOf } from '../badges/engine.js';
import { getSpoofedDate, isSpoofed, nowIso, setSpoofedDate, todayStr } from '../clock.js';
import { config } from '../config.js';
import { createBadgeService } from '../services/badgeService.js';
import { hydrateAll } from '../services/hydrationService.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { badRequest } from '../types.js';

function clockState(extra: Record<string, unknown> = {}) {
  return {
    spoofed: isSpoofed(),
    spoofedDate: getSpoofedDate(),
    now: nowIso(),
    today: todayStr(),
    ...extra,
  };
}

/**
 * Date-spoofing endpoints for scenario testing. After the date changes the
 * hydration loop is re-run so recurring tasks materialise against the new
 * "today" — exactly what the frontend needs to demo/test scenarios. The
 * badge rollover runs too, so jumping across a Monday awards the finished
 * week's badges immediately instead of waiting for the hourly scheduler.
 */
export function debugRouter(storage: StorageProvider): Router {
  const router = Router();

  router.get('/clock', (_req: Request, res: Response) => {
    res.json(clockState());
  });

  router.post('/clock', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const date = (req.body ?? {}).date as string | null | undefined;
      if (date === undefined || date === null) {
        setSpoofedDate(null);
      } else {
        if (typeof date !== 'string') throw badRequest('date must be an ISO date string or null');
        try {
          setSpoofedDate(date);
        } catch {
          throw badRequest(`invalid date: ${date}`);
        }
      }
      const { created } = await hydrateAll(storage, config.hydrationHorizonDays);
      // Same call the scheduler makes hourly (D3). Without it, a spoofed jump
      // across a Monday only materialises tasks; the award ceremony would
      // silently not happen until the next scheduler tick or badge API read.
      const rollover = await createBadgeService(storage).rolloverIfNewWeek();
      res.json(clockState({ hydrated: created, rollover }));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/clock', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      setSpoofedDate(null);
      res.json(clockState());
    } catch (err) {
      next(err);
    }
  });

  /**
   * Scenario-testing reset: delete every hydrated task instance. Pair with
   * /reset-watermarks, then jump the clock to rehydrate a clean slate.
   */
  router.post('/clear-instances', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const cleared = await storage.clearInstances();
      res.json({ cleared });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Scenario-testing reset: set lastHydratedDate back to null on every task
   * definition, so the next hydration pass re-materialises from each
   * definition's anchor (startDate ?? creation date).
   */
  router.post('/reset-watermarks', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const defs = await storage.listDefinitions();
      let reset = 0;
      for (const def of defs) {
        if (def.lastHydratedDate !== null) {
          await storage.updateDefinition(def.id, { lastHydratedDate: null });
          reset++;
        }
      }
      res.json({ reset });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Scenario testing: run the weekly badge rollover on demand — the same
   * function the scheduler calls hourly and badge reads call lazily.
   * Idempotent within a week; pair with the clock spoofer to cross Mondays.
   */
  router.post('/award-badges', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await createBadgeService(storage).rolloverIfNewWeek());
    } catch (err) {
      next(err);
    }
  });

  /**
   * Scenario testing: rewind the badge rollover watermark + epoch to the
   * Monday of the current (server) week — the same values the first-ever
   * rollover initialises with. Unsticks the state after a spoofed clock jump
   * ran a rollover in the future (a lastAwardedWeekStart ahead of today
   * suppresses all awards until real time catches up) and re-bases the epoch
   * so pre-this-week history stops counting toward badge evaluation. Badge
   * awards already in the ledger are kept.
   */
  router.post('/reset-badge-state', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const monday = mondayOf(todayStr());
      res.json(await storage.setBadgeState({ lastAwardedWeekStart: monday, badgesEpoch: monday }));
    } catch (err) {
      next(err);
    }
  });

  /**
   * Scenario testing: wipe the permanent badge award ledger (every award
   * written by past Monday rollovers). The rollover watermark + epoch are
   * untouched, so cleared weeks are not re-awarded — pair with
   * /reset-badge-state for a full badge clean slate.
   */
  router.post('/clear-badge-awards', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ cleared: await storage.clearBadgeAwards() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Scenario testing: wipe the points ledger (grants + revocations) so every
   * user's balance returns to zero, and null the pointsAwarded display
   * snapshot on completed instances so task cards stop showing stale "+N".
   * The completions themselves stay as history.
   */
  router.post('/clear-points', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const cleared = await storage.clearPointEvents();
      let snapshotsCleared = 0;
      for (const instance of await storage.listInstances()) {
        if (instance.pointsAwarded !== null) {
          await storage.updateInstance(instance.id, { pointsAwarded: null });
          snapshotsCleared++;
        }
      }
      res.json({ cleared, snapshotsCleared });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
