import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 2;

export function resolveDbPath(cwd = process.cwd()): string {
  const override = process.env.PI_TASKS_DB_PATH?.trim();
  if (override) return resolve(cwd, override);
  return resolve(cwd, ".pi", "pi-tasks", "tasks.sqlite");
}

export function openTaskDatabase(dbPath = resolveDbPath()): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const versionRow = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  const currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`Unsupported pi-tasks schema version ${currentVersion}; this package supports ${SCHEMA_VERSION}`);
  }

  if (currentVersion === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'thread', 'agent', 'global', 'custom')),
        scope_key TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shared')),
        owner_agent_id TEXT,
        created_by_agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES task_lists(id),
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        notes TEXT,
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'canceled')),
        assigned_to_agent_id TEXT,
        claimed_by_agent_id TEXT,
        claim_expires_at TEXT,
        outcome TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS private_access_events (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES task_lists(id),
        actor_agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_lists_scope ON task_lists(scope_type, scope_key, visibility);
      CREATE INDEX IF NOT EXISTS idx_task_lists_deleted ON task_lists(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_list_position ON tasks(list_id, position);
      CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks(status, claim_expires_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignment ON tasks(list_id, assigned_to_agent_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_private_access_events_list ON private_access_events(list_id, created_at);

      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  if (currentVersion === 1) {
    const columns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const hasResult = columns.some((column) => column.name === "result");
    const hasOutcome = columns.some((column) => column.name === "outcome");
    if (hasResult && !hasOutcome) {
      db.exec("ALTER TABLE tasks RENAME COLUMN result TO outcome");
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

export function withImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}
