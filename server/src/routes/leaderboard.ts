import { Router, type NextFunction, type Request, type Response } from 'express';
import type { LeaderboardService } from '../services/leaderboardService.js';
import { badRequest } from '../types.js';

export function leaderboardRouter(leaderboard: LeaderboardService): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ?weeks omitted → default 1; anything present but not 1/2/4/8 → 400
      // (the service validates the value itself).
      const raw = req.query.weeks;
      if (raw !== undefined && typeof raw !== 'string') throw badRequest('weeks must be one of 1, 2, 4, 8');
      const weeks = raw === undefined ? 1 : Number(raw);
      res.json(await leaderboard.leaderboard(weeks));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
