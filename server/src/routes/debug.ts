import { Router, type Request, type Response, type NextFunction } from 'express';
import { getSpoofedDate, isSpoofed, nowIso, setSpoofedDate, todayStr } from '../clock.js';
import { config } from '../config.js';
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
 * "today" — exactly what the frontend needs to demo/test scenarios.
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
      res.json(clockState({ hydrated: created }));
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

  return router;
}
