import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskDefinition, TaskInstance, User } from '../types.js';
import type { StorageProvider } from './StorageProvider.js';

interface StoreShape {
  users: User[];
  definitions: TaskDefinition[];
  instances: TaskInstance[];
}

const FILES = {
  users: 'users.json',
  definitions: 'task-definitions.json',
  instances: 'task-instances.json',
} as const;

/**
 * JSON-file-backed StorageProvider. Keeps an in-memory cache, persists the
 * whole collection on each mutation using atomic writes (temp file + rename),
 * and serialises writes through a promise queue. Perfectly fine at household
 * scale; swap for a DB-backed provider when you outgrow it.
 */
export class JsonFileStorage implements StorageProvider {
  private readonly data: StoreShape = { users: [], definitions: [], instances: [] };
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly dataDir: string) {}

  static async create(dataDir: string): Promise<JsonFileStorage> {
    const storage = new JsonFileStorage(dataDir);
    await mkdir(dataDir, { recursive: true });
    await storage.load();
    return storage;
  }

  private fileFor(key: keyof StoreShape): string {
    return path.join(this.dataDir, FILES[key]);
  }

  private async load(): Promise<void> {
    for (const key of Object.keys(FILES) as (keyof StoreShape)[]) {
      try {
        const raw = await readFile(this.fileFor(key), 'utf8');
        this.data[key] = JSON.parse(raw) as never;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // Missing file = empty collection; created on first write.
      }
    }
  }

  private persist(key: keyof StoreShape): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const file = this.fileFor(key);
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data[key], null, 2), 'utf8');
      await rename(tmp, file);
    });
    return this.writeQueue;
  }

  // ---------- Users ----------

  listUsers(): Promise<User[]> {
    return Promise.resolve([...this.data.users]);
  }

  getUser(id: string): Promise<User | null> {
    return Promise.resolve(this.data.users.find((u) => u.id === id) ?? null);
  }

  async insertUser(user: User): Promise<User> {
    this.data.users.push(user);
    await this.persist('users');
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    const before = this.data.users.length;
    this.data.users = this.data.users.filter((u) => u.id !== id);
    if (this.data.users.length === before) return false;
    await this.persist('users');
    return true;
  }

  // ---------- Task definitions ----------

  listDefinitions(): Promise<TaskDefinition[]> {
    return Promise.resolve([...this.data.definitions]);
  }

  getDefinition(id: string): Promise<TaskDefinition | null> {
    return Promise.resolve(this.data.definitions.find((d) => d.id === id) ?? null);
  }

  async insertDefinition(def: TaskDefinition): Promise<TaskDefinition> {
    this.data.definitions.push(def);
    await this.persist('definitions');
    return def;
  }

  async updateDefinition(
    id: string,
    patch: Partial<Omit<TaskDefinition, 'id'>>,
  ): Promise<TaskDefinition | null> {
    const def = this.data.definitions.find((d) => d.id === id);
    if (!def) return null;
    Object.assign(def, patch);
    await this.persist('definitions');
    return def;
  }

  async deleteDefinition(id: string): Promise<boolean> {
    const before = this.data.definitions.length;
    this.data.definitions = this.data.definitions.filter((d) => d.id !== id);
    if (this.data.definitions.length === before) return false;
    await this.persist('definitions');
    return true;
  }

  // ---------- Task instances ----------

  listInstances(): Promise<TaskInstance[]> {
    return Promise.resolve([...this.data.instances]);
  }

  getInstance(id: string): Promise<TaskInstance | null> {
    return Promise.resolve(this.data.instances.find((i) => i.id === id) ?? null);
  }

  async insertInstance(instance: TaskInstance): Promise<TaskInstance> {
    this.data.instances.push(instance);
    await this.persist('instances');
    return instance;
  }

  async updateInstance(
    id: string,
    patch: Partial<Omit<TaskInstance, 'id'>>,
  ): Promise<TaskInstance | null> {
    const instance = this.data.instances.find((i) => i.id === id);
    if (!instance) return null;
    Object.assign(instance, patch);
    await this.persist('instances');
    return instance;
  }

  async deleteInstance(id: string): Promise<boolean> {
    const before = this.data.instances.length;
    this.data.instances = this.data.instances.filter((i) => i.id !== id);
    if (this.data.instances.length === before) return false;
    await this.persist('instances');
    return true;
  }

  instanceExists(definitionId: string, occurrenceDate: string): Promise<boolean> {
    return Promise.resolve(
      this.data.instances.some((i) => i.definitionId === definitionId && i.occurrenceDate === occurrenceDate),
    );
  }

  async clearInstances(): Promise<number> {
    const removed = this.data.instances.length;
    if (removed === 0) return 0;
    this.data.instances = [];
    await this.persist('instances');
    return removed;
  }
}
