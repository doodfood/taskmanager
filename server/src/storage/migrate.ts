/**
 * Tiny forward-only SQL migration runner (Liquibase-style, minus the framework).
 *
 * Migrations are numbered .sql files living in a `migrations/` directory next
 * to the compiled output. Each file is applied exactly once, in ascending
 * numeric order, inside a transaction. Applied migrations are recorded in the
 * `schema_migrations` table so re-running is a no-op — the database is only
 * ever migrated forward, never wiped.
 *
 * File naming: `<number>_<description>.sql` (e.g. `001_initial_schema.sql`).
 * The numeric prefix is the migration id; it must be unique and increasing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  id: string;
  file: string;
  sql: string;
}

const MIGRATION_FILE = /^(\d+)_.*\.sql$/;

/** Resolve the migrations directory relative to this module (works from src/ and dist/). */
function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'migrations');
}

/** Read and order all pending-looking migration files from disk. */
function loadMigrations(dir: string): Migration[] {
  const files = readdirSync(dir).filter((f) => MIGRATION_FILE.test(f));
  const migrations = files.map((file) => {
    const id = MIGRATION_FILE.exec(file)![1];
    const sql = readFileSync(path.join(dir, file), 'utf8');
    return { id, file, sql };
  });
  // Numeric order by id (ids are zero-padded, but sort numerically to be safe).
  migrations.sort((a, b) => Number(a.id) - Number(b.id));
  const ids = new Set<string>();
  for (const m of migrations) {
    if (ids.has(m.id)) throw new Error(`Duplicate migration id ${m.id}`);
    ids.add(m.id);
  }
  return migrations;
}

/**
 * Apply any migrations not yet recorded in `schema_migrations`. Returns the
 * ids applied during this call (empty when the database is already current).
 */
export function migrate(db: DatabaseSync, dir: string = migrationsDir()): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[];
  const applied = new Set(appliedRows.map((r) => r.id));

  const pending = loadMigrations(dir).filter((m) => !applied.has(m.id));
  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  const nowApplied: string[] = [];
  for (const m of pending) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      record.run(m.id, new Date().toISOString());
      db.exec('COMMIT');
      nowApplied.push(m.id);
      console.log(`[migrate] applied ${m.file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.file} failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return nowApplied;
}
