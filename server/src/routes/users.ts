import { Router, type Request, type Response, type NextFunction } from 'express';
import type { UserService } from '../services/userService.js';

export function usersRouter(users: UserService): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await users.list());
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await users.create(req.body ?? {});
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await users.remove(req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
