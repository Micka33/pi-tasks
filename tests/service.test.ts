import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NotFoundError, PrivateListAccessError, ValidationError } from "../src/core/errors.js";
import { TaskService } from "../src/core/service.js";
import type { AccessOptions, ActorContext } from "../src/core/types.js";

function tmpDb(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-test-"));
  return {
    dir,
    dbPath: join(dir, "tasks.sqlite"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function actor(agentId: string): AccessOptions {
  return { actor: { agentId, source: "test" } satisfies ActorContext };
}

test("creates lists/tasks and claims the next eligible task without duplicates", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = actor("agent-a");
    const b = actor("agent-b");

    const list = service.createTaskList(
      { id: "shared", name: "Shared", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    service.createTask({ list_id: list.id, title: "assigned to A", assigned_to_agent_id: "agent-a" }, a);
    service.createTask({ list_id: list.id, title: "unassigned" }, a);

    const claimB = service.claimNextTask({ list_id: list.id }, b).task;
    const claimA = service.claimNextTask({ list_id: list.id }, a).task;

    assert.ok(claimB);
    assert.ok(claimA);
    assert.equal(claimB.title, "unassigned");
    assert.equal(claimA.title, "assigned to A");
    assert.notEqual(claimA.id, claimB.id);
    assert.equal(claimA.status, "in_progress");
    assert.equal(claimB.status, "in_progress");
    service.close();
  } finally {
    cleanup();
  }
});

test("claim TTL defaults to 2h and refresh preserves started_at", () => {
  const { dbPath, cleanup } = tmpDb();
  let now = new Date("2026-01-01T00:00:00.000Z");
  try {
    const service = new TaskService({ dbPath, now: () => now });
    const a = actor("agent-a");
    const list = service.createTaskList(
      { id: "ttl", name: "TTL", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    service.createTask({ list_id: list.id, title: "long task" }, a);

    const claimed = service.claimNextTask({ list_id: list.id }, a).task;
    assert.ok(claimed);
    assert.equal(claimed.started_at, "2026-01-01T00:00:00.000Z");
    assert.equal(claimed.claim_expires_at, "2026-01-01T02:00:00.000Z");

    now = new Date("2026-01-01T00:30:00.000Z");
    const refreshed = service.refreshClaim({ task_id: claimed.id }, a);
    assert.equal(refreshed.started_at, claimed.started_at);
    assert.equal(refreshed.claim_expires_at, "2026-01-01T02:30:00.000Z");

    now = new Date("2026-01-01T03:00:00.000Z");
    const released = service.releaseExpiredClaims({ list_id: list.id }, a).released;
    assert.equal(released.length, 1);
    assert.equal(released[0]?.status, "todo");
    assert.equal(released[0]?.started_at, claimed.started_at);

    assert.throws(
      () => service.updateTask({ task_id: claimed.id, status: "in_progress" }, a),
      (error) => error instanceof ValidationError && error.message.includes("task_claim_next"),
    );

    service.close();
  } finally {
    cleanup();
  }
});

test("done update clears claim and sets completed_at", () => {
  const { dbPath, cleanup } = tmpDb();
  let now = new Date("2026-01-01T00:00:00.000Z");
  try {
    const service = new TaskService({ dbPath, now: () => now });
    const a = actor("agent-a");
    const list = service.createTaskList(
      { id: "done", name: "Done", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    service.createTask({ list_id: list.id, title: "finish" }, a);
    const claimed = service.claimNextTask({ list_id: list.id }, a).task;
    assert.ok(claimed);

    now = new Date("2026-01-01T01:00:00.000Z");
    const updated = service.updateTask({ task_id: claimed.id, status: "done", outcome: "ok" }, a);
    assert.equal(updated.status, "done");
    assert.equal(updated.outcome, "ok");
    assert.equal(updated.claimed_by_agent_id, null);
    assert.equal(updated.claim_expires_at, null);
    assert.equal(updated.completed_at, "2026-01-01T01:00:00.000Z");
    service.close();
  } finally {
    cleanup();
  }
});

test("closing a task requires an outcome", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = actor("agent-a");
    const list = service.createTaskList(
      { id: "outcome", name: "Outcome", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    service.createTask({ list_id: list.id, title: "needs outcome" }, a);
    const claimed = service.claimNextTask({ list_id: list.id }, a).task;
    assert.ok(claimed);

    assert.throws(
      () => service.updateTask({ task_id: claimed.id, status: "done" }, a),
      (error) => error instanceof ValidationError && error.message.includes("outcome is required"),
    );
    assert.throws(
      () => service.updateTask({ task_id: claimed.id, status: "done", outcome: "" }, a),
      (error) => error instanceof ValidationError && error.message.includes("outcome is required"),
    );

    const updated = service.updateTask({ task_id: claimed.id, outcome: "Decision: ship. Actions: implemented. Result: tests pass." }, a);
    const closed = service.updateTask({ task_id: updated.id, status: "done" }, a);
    assert.equal(closed.status, "done");
    assert.equal(closed.outcome, "Decision: ship. Actions: implemented. Result: tests pass.");
    service.close();
  } finally {
    cleanup();
  }
});

test("blocked update keeps responsibility on pausing agent unless explicitly released", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = actor("agent-a");
    const list = service.createTaskList(
      { id: "pause", name: "Pause", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    service.addManyTasks(
      {
        list_id: list.id,
        tasks: [{ title: "pause and keep" }, { title: "pause and release" }],
      },
      a,
    );

    const keepClaimed = service.claimNextTask({ list_id: list.id }, a).task;
    assert.ok(keepClaimed);
    const kept = service.updateTask({ task_id: keepClaimed.id, status: "blocked" }, a);
    assert.equal(kept.status, "blocked");
    assert.equal(kept.assigned_to_agent_id, "agent-a");
    assert.equal(kept.claimed_by_agent_id, null);
    assert.equal(kept.claim_expires_at, null);

    const releaseClaimed = service.claimNextTask({ list_id: list.id }, a).task;
    assert.ok(releaseClaimed);
    const released = service.updateTask({ task_id: releaseClaimed.id, status: "blocked", assigned_to_agent_id: null }, a);
    assert.equal(released.status, "blocked");
    assert.equal(released.assigned_to_agent_id, null);
    assert.equal(released.claimed_by_agent_id, null);
    assert.equal(released.claim_expires_at, null);

    service.close();
  } finally {
    cleanup();
  }
});

test("task_list_delete soft-deletes list and active tasks while clearing claims", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = actor("agent-a");
    const list = service.createTaskList(
      { id: "delete-list", name: "Delete List", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    service.addManyTasks({ list_id: list.id, tasks: [{ title: "one" }, { title: "two" }] }, a);
    const claimed = service.claimNextTask({ list_id: list.id }, a).task;
    assert.ok(claimed);

    const deleted = service.deleteTaskList({ list_id: list.id }, a);
    assert.ok(deleted.list.deleted_at);
    assert.equal(deleted.deleted_tasks.length, 2);
    assert.equal(deleted.deleted_tasks.every((task) => task.deleted_at && task.claimed_by_agent_id === null && task.claim_expires_at === null), true);
    assert.deepEqual(service.findTaskLists({}, a), []);
    assert.throws(
      () => service.getTaskList({ list_id: list.id }, a),
      (error) => error instanceof NotFoundError,
    );

    const withDeleted = service.getTaskList({ list_id: list.id, include_deleted: true }, a);
    assert.equal(withDeleted.tasks.length, 2);
    assert.equal(withDeleted.tasks.every((task) => task.deleted_at), true);

    const idempotent = service.deleteTaskList({ list_id: list.id }, a);
    assert.equal(idempotent.list.id, list.id);
    assert.equal(idempotent.deleted_tasks.length, 0);

    service.close();
  } finally {
    cleanup();
  }
});

test("schema migration renames result to outcome", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE task_lists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        visibility TEXT NOT NULL,
        owner_agent_id TEXT,
        created_by_agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES task_lists(id),
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        notes TEXT,
        status TEXT NOT NULL,
        assigned_to_agent_id TEXT,
        claimed_by_agent_id TEXT,
        claim_expires_at TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        deleted_at TEXT
      );
      CREATE TABLE private_access_events (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES task_lists(id),
        actor_agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO task_lists VALUES ('legacy', 'Legacy', 'workspace', '/repo', 'shared', NULL, 'agent-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);
      INSERT INTO tasks VALUES ('legacy-task', 'legacy', 1, 'Legacy task', NULL, NULL, 'done', NULL, NULL, NULL, 'legacy result', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', NULL);
      PRAGMA user_version = 1;
    `);
    db.close();

    const service = new TaskService({ dbPath });
    const data = service.getTaskList({ list_id: "legacy" }, actor("agent-a"));
    assert.equal(data.tasks[0]?.outcome, "legacy result");
    service.close();
  } finally {
    cleanup();
  }
});

test("private lists are hidden, denied, and bypass-audited", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = actor("agent-a");
    const b = actor("agent-b");
    const privateList = service.createTaskList(
      { id: "private", name: "Private", scope_type: "workspace", scope_key: "/repo", visibility: "private" },
      a,
    );

    assert.equal(privateList.owner_agent_id, "agent-a");
    assert.deepEqual(service.findTaskLists({}, b), []);
    assert.throws(
      () => service.getTaskList({ list_id: privateList.id }, b),
      (error) => error instanceof PrivateListAccessError,
    );

    const bypass = service.getTaskList({ list_id: privateList.id }, {
      ...b,
      privateBypass: { toolName: "test", reason: "unit test confirmed bypass" },
    });
    assert.equal(bypass.list.id, privateList.id);
    const events = service.getPrivateAccessEvents(privateList.id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.actor_agent_id, "agent-b");
    assert.equal(events[0]?.tool_name, "test");
    service.close();
  } finally {
    cleanup();
  }
});

test("task_delete is a soft delete hidden from normal reads", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = actor("agent-a");
    const list = service.createTaskList(
      { id: "delete", name: "Delete", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    const task = service.createTask({ list_id: list.id, title: "remove me" }, a);
    const deleted = service.deleteTask({ task_id: task.id }, a);
    assert.ok(deleted.deleted_at);

    const normal = service.getTaskList({ list_id: list.id }, a);
    assert.equal(normal.tasks.length, 0);

    const withDeleted = service.getTaskList({ list_id: list.id, include_deleted: true }, a);
    assert.equal(withDeleted.tasks.length, 1);
    assert.equal(withDeleted.tasks[0]?.id, task.id);
    service.close();
  } finally {
    cleanup();
  }
});

test("reorder places provided task ids first and keeps omitted tasks after them", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = actor("agent-a");
    const list = service.createTaskList(
      { id: "order", name: "Order", scope_type: "workspace", scope_key: "/repo", visibility: "shared" },
      a,
    );
    const tasks = service.addManyTasks(
      {
        list_id: list.id,
        tasks: [{ title: "one" }, { title: "two" }, { title: "three" }],
      },
      a,
    );

    const reordered = service.reorderTasks({ list_id: list.id, task_ids: [tasks[2]!.id, tasks[0]!.id] }, a);
    assert.deepEqual(
      reordered.map((task) => task.title),
      ["three", "one", "two"],
    );
    assert.deepEqual(
      reordered.map((task) => task.position),
      [1, 2, 3],
    );
    service.close();
  } finally {
    cleanup();
  }
});
