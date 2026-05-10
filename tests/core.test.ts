import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolveMcpAgentId, resolvePiAgentId, shortHash } from "../src/core/agent-id.js";
import { migrate, openTaskDatabase, resolveDbPath, SCHEMA_VERSION, withImmediateTransaction } from "../src/core/db.js";
import { ClaimConflictError, NotFoundError, PiTasksError, PrivateListAccessError, serializeError, ValidationError } from "../src/core/errors.js";
import type { TaskList } from "../src/core/types.js";

function tmpDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-core-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

const privateList = (): TaskList => ({
  id: "private-list",
  name: "Private List",
  scope_type: "workspace",
  scope_key: "/repo",
  visibility: "private",
  owner_agent_id: "owner-agent",
  created_by_agent_id: "creator-agent",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
});

test("agent id helpers resolve overrides, sessions, and fallbacks", () => {
  assert.equal(shortHash("abc"), shortHash("abc"));
  assert.equal(shortHash("abc").length, 16);

  withEnv("PI_TASKS_AGENT_ID", " env-agent ", () => {
    assert.deepEqual(resolvePiAgentId(), { agentId: "env-agent", source: "pi" });
    assert.deepEqual(resolveMcpAgentId(), { agentId: "env-agent", source: "mcp" });
  });

  withEnv("PI_TASKS_AGENT_ID", undefined, () => {
    const sessionResolved = resolvePiAgentId({ getSessionFile: () => "/tmp/session.json" });
    assert.equal(sessionResolved.agentId, `pi-session:${shortHash("/tmp/session.json")}`);
    assert.equal(sessionResolved.source, "pi");

    const noSessionFile = resolvePiAgentId({ getSessionFile: () => undefined });
    assert.equal(noSessionFile.agentId.startsWith("pi-ephemeral:"), true);
    assert.equal(noSessionFile.source, "pi");
    assert.ok(noSessionFile.warning);

    const noSessionManager = resolvePiAgentId();
    assert.equal(noSessionManager.agentId.startsWith("pi-ephemeral:"), true);

    const mcp = resolveMcpAgentId();
    assert.equal(mcp.agentId.startsWith("mcp-process:"), true);
    assert.equal(mcp.source, "mcp");
    assert.ok(mcp.warning);
  });
});

test("database helpers resolve paths, migrate schemas, and manage transactions", () => {
  const { dir, cleanup } = tmpDir();
  try {
    withEnv("PI_TASKS_DB_PATH", undefined, () => {
      assert.equal(resolveDbPath(dir), resolve(dir, ".pi", "pi-tasks", "tasks.sqlite"));
    });
    withEnv("PI_TASKS_DB_PATH", "custom/tasks.sqlite", () => {
      assert.equal(resolveDbPath(dir), resolve(dir, "custom", "tasks.sqlite"));
    });

    const dbPath = join(dir, "nested", "tasks.sqlite");
    const db = openTaskDatabase(dbPath);
    try {
      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(version.user_version, SCHEMA_VERSION);
      withImmediateTransaction(db, () => {
        db.prepare("INSERT INTO task_lists VALUES ('tx', 'Tx', 'workspace', '/repo', 'shared', NULL, 'agent', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)").run();
      });
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM task_lists").get() as { count: number }).count, 1);
      assert.throws(
        () => withImmediateTransaction(db, () => {
          db.prepare("INSERT INTO task_lists VALUES ('rollback', 'Rollback', 'workspace', '/repo', 'shared', NULL, 'agent', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)").run();
          throw new Error("boom");
        }),
        /boom/,
      );
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM task_lists WHERE id = 'rollback'").get() as { count: number }).count, 0);
    } finally {
      db.close();
    }

    const future = new DatabaseSync(":memory:");
    try {
      future.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      assert.throws(() => migrate(future), /Unsupported pi-tasks schema version/);
    } finally {
      future.close();
    }

    const alreadyOutcome = new DatabaseSync(":memory:");
    try {
      alreadyOutcome.exec(`CREATE TABLE tasks (id TEXT, outcome TEXT); PRAGMA user_version = 1;`);
      migrate(alreadyOutcome);
      assert.equal((alreadyOutcome.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
    } finally {
      alreadyOutcome.close();
    }

    const fakeMigrateCalls: string[] = [];
    migrate({
      prepare: () => ({ get: () => undefined }),
      exec: (sql: string) => { fakeMigrateCalls.push(sql); },
    } as any);
    assert.equal(fakeMigrateCalls.length, 1);

    const calls: string[] = [];
    const rollbackFails = {
      exec(sql: string) {
        calls.push(sql);
        if (sql === "ROLLBACK") throw new Error("rollback failed");
      },
    } as unknown as DatabaseSync;
    assert.throws(() => withImmediateTransaction(rollbackFails, () => { throw new Error("original"); }), /original/);
    assert.deepEqual(calls, ["BEGIN IMMEDIATE", "ROLLBACK"]);
  } finally {
    cleanup();
  }
});

test("errors serialize domain, generic, and non-error values", () => {
  const validation = new ValidationError("bad input", { field: "name" });
  assert.deepEqual(serializeError(validation), {
    name: "ValidationError",
    code: "VALIDATION_ERROR",
    message: "bad input",
    details: { field: "name" },
  });

  assert.deepEqual(serializeError(new Error("generic")), { name: "Error", message: "generic" });
  assert.deepEqual(serializeError("plain"), { message: "plain" });

  const notFound = new NotFoundError("task", "task-1");
  assert.equal(notFound.code, "NOT_FOUND");
  assert.equal(notFound.name, "NotFoundError");

  const conflict = new ClaimConflictError("claimed", { task_id: "task-1" });
  assert.equal(conflict.code, "CLAIM_CONFLICT");
  assert.equal(conflict.name, "ClaimConflictError");

  const privateError = new PrivateListAccessError(privateList(), "agent-b", "tool-x");
  assert.equal(privateError.code, "PRIVATE_LIST_ACCESS_DENIED");
  assert.equal(privateError.details.list_id, "private-list");
  assert.equal(privateError.toolName, "tool-x");

  const base = new PiTasksError("BASE", "base message");
  assert.equal(base.name, "PiTasksError");
  assert.deepEqual(base.details, {});
});
