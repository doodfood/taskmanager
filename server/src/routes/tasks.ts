import { Router, type Request, type Response, type NextFunction } from 'express';
import type { TaskService } from '../services/taskService.js';
import { badRequest } from '../types.js';

export function definitionsRouter(tasks: TaskService): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await tasks.listDefinitions());
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const def = await tasks.createDefinition(req.body ?? {});
      res.status(201).json(def);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await tasks.updateDefinition(req.params.id, req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await tasks.deleteDefinition(req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function instancesRouter(tasks: TaskService): Router {
  const router = Router();

  // NB: /upcoming must be registered before /:id-style routes.
  router.get('/upcoming', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
      if (!userId) throw badRequest('userId query param is required');
      const days = req.query.days !== undefined ? Number(req.query.days) : 7;
      res.json(await tasks.upcoming(userId, days));
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = req.query;
      const status = q.status as 'pending' | 'completed' | undefined;
      if (status !== undefined && status !== 'pending' && status !== 'completed') {
        throw badRequest('status must be pending or completed');
      }
      const assigneeId =
        q.assigneeId === undefined ? undefined : q.assigneeId === 'null' || q.assigneeId === '' ? null : String(q.assigneeId);
      res.json(
        await tasks.listInstances({
          status,
          assigneeId,
          from: typeof q.from === 'string' ? q.from : undefined,
          to: typeof q.to === 'string' ? q.to : undefined,
          includeAnyone: q.includeAnyone === 'true',
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await tasks.complete(req.params.id, (req.body ?? {}).completedBy));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/reopen', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await tasks.reopen(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/reassign', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await tasks.reassign(req.params.id, (req.body ?? {}).assigneeId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
