import { randomUUID } from 'node:crypto';
import { nowIso } from '../clock.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { badRequest, notFound, type User } from '../types.js';

const PALETTE = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export function createUserService(storage: StorageProvider) {
  return {
    list(): Promise<User[]> {
      return storage.listUsers();
    },

    async create(input: { name?: unknown; color?: unknown }): Promise<User> {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) throw badRequest('name is required');
      const color =
        typeof input.color === 'string' && input.color.trim()
          ? input.color.trim()
          : PALETTE[(await storage.listUsers()).length % PALETTE.length];
      const user: User = { id: randomUUID(), name, color, createdAt: nowIso() };
      return storage.insertUser(user);
    },

    async remove(id: string): Promise<void> {
      if (!(await storage.deleteUser(id))) throw notFound(`user ${id} not found`);
    },

    async ensureSeeded(names: string[]): Promise<void> {
      const existing = await storage.listUsers();
      if (existing.length > 0) return;
      for (const name of names) {
        await this.create({ name });
      }
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
