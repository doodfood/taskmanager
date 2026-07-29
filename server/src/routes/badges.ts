import { Router, type Request, type Response } from 'express';
import type { BadgeService } from '../services/badgeService.js';

export function badgesRouter(badges: BadgeService): Router {
  const router = Router();

  // The badge catalogue: categories → badges (tier, priority, valueKind, description).
  router.get('/', (_req: Request, res: Response) => {
    res.json(badges.catalogue());
  });

  return router;
}
