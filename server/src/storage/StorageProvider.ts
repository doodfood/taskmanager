import type { BadgeAward, BadgeState, PointEvent, TaskDefinition, TaskInstance, User } from '../types.js';

/**
 * The DB seam. Every persistence operation goes through this interface, so a
 * real database can be swapped in later by implementing it and changing one
 * line in the composition root (src/index.ts).
 */
export interface StorageProvider {
  // Users
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  insertUser(user: User): Promise<User>;
  deleteUser(id: string): Promise<boolean>;

  // Task definitions (templates)
  listDefinitions(): Promise<TaskDefinition[]>;
  getDefinition(id: string): Promise<TaskDefinition | null>;
  insertDefinition(def: TaskDefinition): Promise<TaskDefinition>;
  updateDefinition(id: string, patch: Partial<Omit<TaskDefinition, 'id'>>): Promise<TaskDefinition | null>;
  deleteDefinition(id: string): Promise<boolean>;

  // Task instances (materialised occurrences)
  listInstances(): Promise<TaskInstance[]>;
  getInstance(id: string): Promise<TaskInstance | null>;
  insertInstance(instance: TaskInstance): Promise<TaskInstance>;
  updateInstance(id: string, patch: Partial<Omit<TaskInstance, 'id'>>): Promise<TaskInstance | null>;
  deleteInstance(id: string): Promise<boolean>;
  instanceExists(definitionId: string, occurrenceDate: string): Promise<boolean>;
  /** Removes every instance; returns the number removed. Used by debug/test tooling. */
  clearInstances(): Promise<number>;

  // Points ledger (append-only gamification history)
  listPointEvents(): Promise<PointEvent[]>;
  insertPointEvent(event: PointEvent): Promise<PointEvent>;
  /** Removes every point event; returns the number removed. Used by debug/test tooling. */
  clearPointEvents(): Promise<number>;

  // Badge awards (append-only; written once per week at the Monday rollover)
  listBadgeAwards(): Promise<BadgeAward[]>;
  insertBadgeAward(award: BadgeAward): Promise<BadgeAward>;
  /** Removes every badge award; returns the number removed. Used by debug/test tooling. */
  clearBadgeAwards(): Promise<number>;

  // Badge rollover watermark + epoch (null until the first rollover runs)
  getBadgeState(): Promise<BadgeState | null>;
  setBadgeState(state: BadgeState): Promise<BadgeState>;
}
