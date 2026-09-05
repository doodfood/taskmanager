-- Initial schema for the household task manager.
-- Mirrors the shapes previously stored as JSON files. Booleans are stored as
-- INTEGER 0/1; arrays (autoAssignableTo) as JSON text; dates/timestamps as
-- ISO text (yyyy-MM-dd or full ISO-8601), matching the existing domain types.

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE task_definitions (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  recurrence         TEXT NOT NULL,
  points             INTEGER NOT NULL,
  auto_assignable_to TEXT NOT NULL DEFAULT '[]', -- JSON array of user ids
  due_offset_days    INTEGER NOT NULL,
  start_date         TEXT,                          -- yyyy-MM-dd or NULL
  active             INTEGER NOT NULL DEFAULT 1,    -- 0/1
  last_hydrated_date TEXT,                          -- yyyy-MM-dd or NULL
  created_at         TEXT NOT NULL
);

CREATE TABLE task_instances (
  id              TEXT PRIMARY KEY,
  definition_id   TEXT NOT NULL REFERENCES task_definitions(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  assignee_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  assignment_kind TEXT NOT NULL DEFAULT 'none',     -- 'auto' | 'manual' | 'none'
  points          INTEGER NOT NULL,
  occurrence_date TEXT NOT NULL,                    -- yyyy-MM-dd
  due_date        TEXT NOT NULL,                    -- yyyy-MM-dd
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'completed'
  completed_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at    TEXT,
  points_awarded  INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_task_instances_definition ON task_instances(definition_id);
CREATE INDEX idx_task_instances_assignee ON task_instances(assignee_id);
CREATE INDEX idx_task_instances_occurrence ON task_instances(occurrence_date);
CREATE INDEX idx_task_instances_status ON task_instances(status);

-- Append-only points ledger. kind discriminates grant vs revocation; the
-- grant-only / revocation-only columns are NULL on the other variant.
CREATE TABLE point_events (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                 -- 'grant' | 'revocation'
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instance_id   TEXT NOT NULL,
  definition_id TEXT,                          -- grant only
  title         TEXT,                          -- grant only
  face_value    INTEGER,                       -- grant only
  points        INTEGER NOT NULL,
  timing        TEXT,                          -- grant only: 'early'|'on-time'|'late'
  days_late     INTEGER,                       -- grant only
  completed_at  TEXT,                          -- grant only
  grant_id      TEXT,                          -- revocation only
  reopened_at   TEXT                           -- revocation only
);
CREATE INDEX idx_point_events_user ON point_events(user_id);
CREATE INDEX idx_point_events_instance ON point_events(instance_id);

-- Append-only badge awards, written once per week at the Monday rollover.
CREATE TABLE badge_awards (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   TEXT NOT NULL,
  value      INTEGER,
  week_start TEXT NOT NULL,                    -- yyyy-MM-dd (Monday)
  awarded_at TEXT NOT NULL
);
CREATE INDEX idx_badge_awards_user ON badge_awards(user_id);

-- Single-row rollover watermark + epoch (id = 1). NULL until first rollover.
CREATE TABLE badge_state (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  last_awarded_week_start TEXT NOT NULL,
  badges_epoch            TEXT NOT NULL
);
