import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { debugRouter } from './routes/debug.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { definitionsRouter, instancesRouter } from './routes/tasks.js';
import { usersRouter } from './routes/users.js';
import { createLeaderboardService } from './services/leaderboardService.js';
import { createTaskService } from './services/taskService.js';
import { createUserService } from './services/userService.js';
import type { StorageProvider } from './storage/StorageProvider.js';
import { HttpError } from './types.js';

/**
 * Composition root: given any StorageProvider, build the Express app.
 * This is the single place a DB-backed provider would be swapped in.
 */
export function buildApp(storage: StorageProvider): Express {
  const users = createUserService(storage);
  const tasks = createTaskService(storage);
  const leaderboard = createLeaderboardService(storage);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use('/api/users', usersRouter(users));
  app.use('/api/task-definitions', definitionsRouter(tasks));
  app.use('/api/task-instances', instancesRouter(tasks));
  app.use('/api/leaderboard', leaderboardRouter(leaderboard));
  app.use('/api/debug', debugRouter(storage));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
