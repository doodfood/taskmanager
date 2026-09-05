import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AssignmentKind,
  BadgeAward,
  BadgeState,
  PointEvent,
  PointGrant,
  PointRevocation,
  Recurrence,
  TaskDefinition,
  TaskInstance,
  TaskStatus,
  User,
} from '../types.js';
import { migrate } from './migrate.js';
import type { StorageProvider } from './StorageProvider.js';

const DB_FILENAME = 'taskmanager.db';

/**
 * SQLite-backed StorageProvider using the built-in `node:sqlite` driver (no
 * native dependencies — ideal for the Raspberry Pi). All values are passed as
 * bound parameters; the only string interpolation anywhere in this file is for
 * a fixed set of hardcoded column names in update statements, never user data.
 *
 * The schema is created/advanced by the forward-only migration runner on
 * construction, so opening an existing database never wipes it.
 */
export class SqliteStorage implements StorageProvider {
  private constructor(private readonly db: DatabaseSync) {}

  static create(dataDir: string): SqliteStorage {
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, DB_FILENAME));
    // WAL for safe concurrent reads while the scheduler writes; FK enforcement.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return new SqliteStorage(db);
  }

  /** Close the underlying database handle (used by tests). */
  close(): void {
    this.db.close();
  }

  // ---------- row mappers ----------

  private static toUser(r: Record<string, unknown>): User {
    return { id: r.id as string, name: r.name as string, color: r.color as string, createdAt: r.created_at as string };
  }

  private static toDefinition(r: Record<string, unknown>): TaskDefinition {
    return {
      id: r.id as string,
      title: r.title as string,
      description: r.description as string,
      recurrence: r.recurrence as Recurrence,
      points: r.points as number,
      autoAssignableTo: JSON.parse((r.auto_assignable_to as string) ?? '[]') as string[],
      dueOffsetDays: r.due_offset_days as number,
      startDate: (r.start_date as string | null) ?? null,
      active: (r.active as number) === 1,
      lastHydratedDate: (r.last_hydrated_date as string | null) ?? null,
      createdAt: r.created_at as string,
    };
  }

  private static toInstance(r: Record<string, unknown>): TaskInstance {
    return {
      id: r.id as string,
      definitionId: r.definition_id as string,
      title: r.title as string,
      description: r.description as string,
      assigneeId: (r.assignee_id as string | null) ?? null,
      assignmentKind: r.assignment_kind as AssignmentKind,
      points: r.points as number,
      occurrenceDate: r.occurrence_date as string,
      dueDate: r.due_date as string,
      status: r.status as TaskStatus,
      completedBy: (r.completed_by as string | null) ?? null,
      completedAt: (r.completed_at as string | null) ?? null,
      pointsAwarded: (r.points_awarded as number | null) ?? null,
      createdAt: r.created_at as string,
    };
  }

  private static toPointEvent(r: Record<string, unknown>): PointEvent {
    if (r.kind === 'grant') {
      const g: PointGrant = {
        id: r.id as string,
        kind: 'grant',
        userId: r.user_id as string,
        instanceId: r.instance_id as string,
        definitionId: r.definition_id as string,
        title: r.title as string,
        faceValue: r.face_value as number,
        points: r.points as number,
        timing: r.timing as PointGrant['timing'],
        daysLate: r.days_late as number,
        completedAt: r.completed_at as string,
      };
      return g;
    }
    const rev: PointRevocation = {
      id: r.id as string,
      kind: 'revocation',
      grantId: r.grant_id as string,
      userId: r.user_id as string,
      instanceId: r.instance_id as string,
      points: r.points as number,
      reopenedAt: r.reopened_at as string,
    };
    return rev;
  }

  private static toBadgeAward(r: Record<string, unknown>): BadgeAward {
    return {
      id: r.id as string,
      kind: 'badge-award',
      userId: r.user_id as string,
      badgeId: r.badge_id as string,
      value: (r.value as number | null) ?? null,
      weekStart: r.week_start as string,
      awardedAt: r.awarded_at as string,
    };
  }

  // ---------- Users ----------

  async listUsers(): Promise<User[]> {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at').all();
    return rows.map(SqliteStorage.toUser);
  }

  async getUser(id: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? SqliteStorage.toUser(row) : null;
  }

  async insertUser(user: User): Promise<User> {
    this.db.prepare('INSERT INTO users (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
      user.id, user.name, user.color, user.createdAt,
    );
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ---------- Task definitions ----------

  async listDefinitions(): Promise<TaskDefinition[]> {
    const rows = this.db.prepare('SELECT * FROM task_definitions ORDER BY created_at').all();
    return rows.map(SqliteStorage.toDefinition);
  }

  async getDefinition(id: string): Promise<TaskDefinition | null> {
    const row = this.db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(id);
    return row ? SqliteStorage.toDefinition(row) : null;
  }

  async insertDefinition(def: TaskDefinition): Promise<TaskDefinition> {
    this.db.prepare(`
      INSERT INTO task_definitions
        (id, title, description, recurrence, points, auto_assignable_to, due_offset_days, start_date, active, last_hydrated_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      def.id, def.title, def.description, def.recurrence, def.points,
      JSON.stringify(def.autoAssignableTo ?? []), def.dueOffsetDays,
      def.startDate, def.active ? 1 : 0, def.lastHydratedDate, def.createdAt,
    );
    return def;
  }

  async updateDefinition(
    id: string,
    patch: Partial<Omit<TaskDefinition, 'id'>>,
  ): Promise<TaskDefinition | null> {
    const existing = await this.getDefinition(id);
    if (!existing) return null;
    const merged: TaskDefinition = { ...existing, ...patch };
    this.db.prepare(`
      UPDATE task_definitions SET
        title = ?, description = ?, recurrence = ?, points = ?, auto_assignable_to = ?,
        due_offset_days = ?, start_date = ?, active = ?, last_hydrated_date = ?, created_at = ?
      WHERE id = ?
    `).run(
      merged.title, merged.description, merged.recurrence, merged.points,
      JSON.stringify(merged.autoAssignableTo ?? []), merged.dueOffsetDays,
      merged.startDate, merged.active ? 1 : 0, merged.lastHydratedDate, merged.createdAt, id,
    );
    return merged;
  }

  async deleteDefinition(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM task_definitions WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ---------- Task instances ----------

  async listInstances(): Promise<TaskInstance[]> {
    const rows = this.db.prepare('SELECT * FROM task_instances ORDER BY occurrence_date, created_at').all();
    return rows.map(SqliteStorage.toInstance);
  }

  async getInstance(id: string): Promise<TaskInstance | null> {
    const row = this.db.prepare('SELECT * FROM task_instances WHERE id = ?').get(id);
    return row ? SqliteStorage.toInstance(row) : null;
  }

  async insertInstance(instance: TaskInstance): Promise<TaskInstance> {
    this.db.prepare(`
      INSERT INTO task_instances
        (id, definition_id, title, description, assignee_id, assignment_kind, points, occurrence_date, due_date, status, completed_by, completed_at, points_awarded, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instance.id, instance.definitionId, instance.title, instance.description,
      instance.assigneeId, instance.assignmentKind, instance.points,
      instance.occurrenceDate, instance.dueDate, instance.status,
      instance.completedBy, instance.completedAt, instance.pointsAwarded, instance.createdAt,
    );
    return instance;
  }

  async updateInstance(
    id: string,
    patch: Partial<Omit<TaskInstance, 'id'>>,
  ): Promise<TaskInstance | null> {
    const existing = await this.getInstance(id);
    if (!existing) return null;
    const merged: TaskInstance = { ...existing, ...patch };
    this.db.prepare(`
      UPDATE task_instances SET
        definition_id = ?, title = ?, description = ?, assignee_id = ?, assignment_kind = ?,
        points = ?, occurrence_date = ?, due_date = ?, status = ?, completed_by = ?,
        completed_at = ?, points_awarded = ?, created_at = ?
      WHERE id = ?
    `).run(
      merged.definitionId, merged.title, merged.description, merged.assigneeId,
      merged.assignmentKind, merged.points, merged.occurrenceDate, merged.dueDate,
      merged.status, merged.completedBy, merged.completedAt, merged.pointsAwarded,
      merged.createdAt, id,
    );
    return merged;
  }

  async deleteInstance(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM task_instances WHERE id = ?').run(id);
    return res.changes > 0;
  }

  async instanceExists(definitionId: string, occurrenceDate: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 AS x FROM task_instances WHERE definition_id = ? AND occurrence_date = ? LIMIT 1')
      .get(definitionId, occurrenceDate);
    return row !== undefined;
  }

  async clearInstances(): Promise<number> {
    const res = this.db.prepare('DELETE FROM task_instances').run();
    return Number(res.changes);
  }

  // ---------- Points ledger ----------

  async listPointEvents(): Promise<PointEvent[]> {
    // Order grants by completion and revocations by reopen, interleaved by time.
    const rows = this.db.prepare(`
      SELECT * FROM point_events
      ORDER BY COALESCE(completed_at, reopened_at), id
    `).all();
    return rows.map(SqliteStorage.toPointEvent);
  }

  async insertPointEvent(event: PointEvent): Promise<PointEvent> {
    if (event.kind === 'grant') {
      this.db.prepare(`
        INSERT INTO point_events
          (id, kind, user_id, instance_id, definition_id, title, face_value, points, timing, days_late, completed_at, grant_id, reopened_at)
        VALUES (?, 'grant', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(
        event.id, event.userId, event.instanceId, event.definitionId, event.title,
        event.faceValue, event.points, event.timing, event.daysLate, event.completedAt,
      );
    } else {
      this.db.prepare(`
        INSERT INTO point_events
          (id, kind, user_id, instance_id, definition_id, title, face_value, points, timing, days_late, completed_at, grant_id, reopened_at)
        VALUES (?, 'revocation', ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)
      `).run(event.id, event.userId, event.instanceId, event.points, event.grantId, event.reopenedAt);
    }
    return event;
  }

  async clearPointEvents(): Promise<number> {
    const res = this.db.prepare('DELETE FROM point_events').run();
    return Number(res.changes);
  }

  // ---------- Badge awards ----------

  async listBadgeAwards(): Promise<BadgeAward[]> {
    const rows = this.db.prepare('SELECT * FROM badge_awards ORDER BY awarded_at, id').all();
    return rows.map(SqliteStorage.toBadgeAward);
  }

  async insertBadgeAward(award: BadgeAward): Promise<BadgeAward> {
    this.db.prepare(`
      INSERT INTO badge_awards (id, user_id, badge_id, value, week_start, awarded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(award.id, award.userId, award.badgeId, award.value, award.weekStart, award.awardedAt);
    return award;
  }

  async clearBadgeAwards(): Promise<number> {
    const res = this.db.prepare('DELETE FROM badge_awards').run();
    return Number(res.changes);
  }

  // ---------- Badge rollover state ----------

  async getBadgeState(): Promise<BadgeState | null> {
    const row = this.db.prepare('SELECT last_awarded_week_start, badges_epoch FROM badge_state WHERE id = 1').get();
    if (!row) return null;
    return {
      lastAwardedWeekStart: (row as Record<string, unknown>).last_awarded_week_start as string,
      badgesEpoch: (row as Record<string, unknown>).badges_epoch as string,
    };
  }

  async setBadgeState(state: BadgeState): Promise<BadgeState> {
    this.db.prepare(`
      INSERT INTO badge_state (id, last_awarded_week_start, badges_epoch)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_awarded_week_start = excluded.last_awarded_week_start, badges_epoch = excluded.badges_epoch
    `).run(state.lastAwardedWeekStart, state.badgesEpoch);
    return state;
  }
}
