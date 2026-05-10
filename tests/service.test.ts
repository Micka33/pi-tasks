import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ClaimConflictError, NotFoundError, PrivateListAccessError, ValidationError } from "../src/core/errors.js";
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

test("service validates inputs and handles list/task edge cases", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath, now: () => new Date("2026-01-01T00:00:00.000Z") });
    const a = actor("agent-a");
    const b = actor("agent-b");

    assert.deepEqual(service.getAgentSummary(a.actor), { db_path: dbPath, agent_id: "agent-a", source: "test" });
    assert.throws(() => service.createTaskList({ name: "Bad", scope_type: "bad" as any, scope_key: "/repo" }, a), ValidationError);
    assert.throws(() => service.createTaskList({ name: "Bad", scope_type: "workspace", scope_key: "/repo", visibility: "bad" as any }, a), ValidationError);
    assert.throws(() => service.createTaskList({ name: " ", scope_type: "workspace", scope_key: "/repo" }, a), ValidationError);
    assert.throws(() => service.createTaskList({ name: "Bad", scope_type: "workspace", scope_key: " " }, a), ValidationError);

    const shared = service.createTaskList(
      { name: "Shared Filters", scope_type: "workspace", scope_key: "/repo", visibility: "shared", owner_agent_id: "owner-x" },
      a,
    );
    const ownerless = service.createTaskList(
      { id: "ownerless", name: "Ownerless", scope_type: "custom", scope_key: "custom-key", visibility: "shared", owner_agent_id: null },
      a,
    );
    const privateList = service.createTaskList(
      { id: "private-filters", name: "Private Filters", scope_type: "workspace", scope_key: "/repo", visibility: "private" },
      a,
    );
    const creatorPrivateList = service.createTaskList(
      { id: "creator-private", name: "Creator Private", scope_type: "workspace", scope_key: "/repo", visibility: "private", owner_agent_id: null },
      a,
    );

    assert.equal(shared.owner_agent_id, "owner-x");
    assert.equal(ownerless.owner_agent_id, null);
    assert.equal(privateList.owner_agent_id, "agent-a");
    assert.equal(creatorPrivateList.owner_agent_id, null);
    assert.equal(service.getTaskList({ list_id: creatorPrivateList.id }, a).list.id, creatorPrivateList.id);
    assert.throws(() => service.getTaskList({ list_id: creatorPrivateList.id }, b), PrivateListAccessError);
    assert.equal(service.findTaskLists({ scope_type: "workspace", scope_key: "/repo", visibility: "shared", owner_agent_id: "owner-x", created_by_agent_id: "agent-a", name: "filters" }, b).length, 1);
    assert.equal(service.findTaskLists({ owner_agent_id: null }, b).some((list) => list.id === ownerless.id), true);
    assert.throws(() => service.findTaskLists({ scope_type: "nope" as any }, a), ValidationError);
    assert.throws(() => service.findTaskLists({ visibility: "nope" as any }, a), ValidationError);
    assert.throws(() => service.findTaskLists({ include_inaccessible_private: true }, b), PrivateListAccessError);
    assert.equal(
      service.findTaskLists(
        { include_inaccessible_private: true },
        { ...b, privateBypass: { toolName: "find", reason: "confirmed" } },
      ).some((list) => list.id === privateList.id),
      true,
    );

    assert.throws(() => service.createTask({ list_id: shared.id, title: " " }, a), ValidationError);
    assert.throws(() => service.createTask({ list_id: shared.id, title: "bad", position: 0 }, a), ValidationError);
    const second = service.createTask({ id: "second", list_id: shared.id, title: " second ", description: " ", notes: " note ", assigned_to_agent_id: " " }, a);
    const first = service.createTask({ id: "first", list_id: shared.id, title: "first", position: 1 }, a);
    const ordered = service.getTaskList({ list_id: shared.id }, a).tasks;
    assert.deepEqual(ordered.map((task) => task.id), ["first", "second"]);
    assert.deepEqual(service.getTaskList({ list_id: shared.id, statuses: ["todo"] }, a).tasks.map((task) => task.id), ["first", "second"]);
    assert.equal(second.description, null);
    assert.equal(second.assigned_to_agent_id, null);

    assert.throws(() => service.addManyTasks({ list_id: shared.id, tasks: [] }, a), ValidationError);
    assert.throws(() => service.addManyTasks({ list_id: shared.id, tasks: "nope" as any }, a), ValidationError);
    assert.throws(() => service.addManyTasks({ list_id: shared.id, tasks: [{ title: " " }] }, a), ValidationError);
    assert.equal(service.addManyTasks({ list_id: shared.id, tasks: [{ id: "many-id", title: "many with id" }] }, a)[0]?.id, "many-id");

    const none = service.claimNextTask({ list_id: ownerless.id, release_expired_first: false }, a);
    assert.equal(none.task, null);
    assert.throws(() => service.claimNextTask({ list_id: shared.id, claim_ttl_seconds: 0 }, a), ValidationError);

    const claimed = service.claimNextTask({ list_id: shared.id, release_expired_first: false, claim_ttl_seconds: 1.8 }, a).task;
    assert.ok(claimed);
    assert.throws(() => service.refreshClaim({ task_id: claimed.id, claim_ttl_seconds: -1 }, a), ValidationError);
    assert.throws(() => service.refreshClaim({ task_id: claimed.id }, b), ClaimConflictError);
    service.updateTask({ task_id: claimed.id, description: "safe edit by another agent" }, b);
    assert.throws(() => service.updateTask({ task_id: claimed.id, status: "done", outcome: "done" }, b), ClaimConflictError);
    service.updateTask({ task_id: claimed.id, notes: "updated notes" }, b);
    const backToTodo = service.updateTask({ task_id: claimed.id, status: "todo", assigned_to_agent_id: null }, a);
    assert.equal(backToTodo.status, "todo");

    assert.throws(() => service.refreshClaim({ task_id: claimed.id }, a), ClaimConflictError);
    assert.throws(() => service.updateTask({ task_id: claimed.id, status: "invalid" as any }, a), ValidationError);
    assert.throws(() => service.updateTask({ task_id: claimed.id, title: " " }, a), ValidationError);
    const unchanged = service.updateTask({ task_id: claimed.id }, a);
    assert.equal(unchanged.id, claimed.id);

    assert.throws(() => service.reorderTasks({ list_id: shared.id, task_ids: "nope" as any }, a), ValidationError);
    assert.throws(() => service.reorderTasks({ list_id: shared.id, task_ids: ["first", "first"] }, a), ValidationError);
    assert.throws(() => service.reorderTasks({ list_id: shared.id, task_ids: ["missing"] }, a), NotFoundError);

    const deleted = service.deleteTask({ task_id: claimed.id }, a);
    assert.ok(deleted.deleted_at);
    assert.equal(service.deleteTask({ task_id: claimed.id }, a).deleted_at, deleted.deleted_at);
    assert.throws(() => service.updateTask({ task_id: claimed.id, title: "deleted" }, a), NotFoundError);
    assert.throws(() => service.getTaskList({ list_id: shared.id, statuses: ["bad" as any] }, a), ValidationError);
    assert.throws(() => service.getTaskList({ list_id: "missing" }, a), NotFoundError);
    assert.throws(() => service.deleteTask({ task_id: "missing" }, a), NotFoundError);

    const emptyServiceDb = tmpDb();
    try {
      const emptyService = new TaskService({ dbPath: emptyServiceDb.dbPath });
      assert.deepEqual(emptyService.getPrivateAccessEvents({}, actor("agent-z")), []);
      emptyService.close();
    } finally {
      emptyServiceDb.cleanup();
    }
    assert.throws(() => service.getPrivateAccessEvents({ actor_agent_id: " " }, a), ValidationError);
    assert.throws(() => service.getPrivateAccessEvents({ tool_name: " " }, a), ValidationError);
    assert.throws(() => service.getPrivateAccessEvents({ limit: 1001 }, a), ValidationError);

    service.close();
  } finally {
    cleanup();
  }
});

test("releaseExpiredClaims releases only visible expired claims", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const service = new TaskService({ dbPath, now: () => now });
    const a = actor("agent-a");
    const b = actor("agent-b");
    const shared = service.createTaskList({ id: "expired-shared", name: "Expired Shared", scope_type: "workspace", scope_key: "/repo" }, a);
    const privateList = service.createTaskList({ id: "expired-private", name: "Expired Private", scope_type: "workspace", scope_key: "/repo", visibility: "private" }, a);
    service.createTask({ id: "shared-task", list_id: shared.id, title: "shared" }, a);
    service.createTask({ id: "private-task", list_id: privateList.id, title: "private" }, a);
    service.claimNextTask({ list_id: shared.id, claim_ttl_seconds: 1 }, a);
    service.claimNextTask({ list_id: privateList.id, claim_ttl_seconds: 1 }, a);

    now = new Date("2026-01-01T00:00:02.000Z");
    const releasedForB = service.releaseExpiredClaims({}, b).released;
    assert.deepEqual(releasedForB.map((task) => task.id), ["shared-task"]);
    const releasedForA = service.releaseExpiredClaims({ list_id: privateList.id }, a).released;
    assert.deepEqual(releasedForA.map((task) => task.id), ["private-task"]);

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

test("row conversion rejects invalid SQLite field types", () => {
  const badNumber = tmpDb();
  try {
    const service = new TaskService({ dbPath: badNumber.dbPath });
    const a = actor("agent-a");
    service.createTaskList({ id: "bad-number", name: "Bad Number", scope_type: "workspace", scope_key: "/repo" }, a);
    service.close();
    const raw = new DatabaseSync(badNumber.dbPath);
    raw.prepare("INSERT INTO tasks VALUES ('bad-task', 'bad-number', X'01', 'Bad', NULL, NULL, 'todo', NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL)").run();
    raw.close();
    const reader = new TaskService({ dbPath: badNumber.dbPath });
    assert.throws(() => reader.getTaskList({ list_id: "bad-number" }, a), /Expected number field position/);
    reader.close();
  } finally {
    badNumber.cleanup();
  }

  const badNullable = tmpDb();
  try {
    const service = new TaskService({ dbPath: badNullable.dbPath });
    const a = actor("agent-a");
    service.createTaskList({ id: "bad-nullable", name: "Bad Nullable", scope_type: "workspace", scope_key: "/repo" }, a);
    service.close();
    const raw = new DatabaseSync(badNullable.dbPath);
    raw.prepare("INSERT INTO tasks VALUES ('bad-task', 'bad-nullable', 1, 'Bad', NULL, NULL, 'todo', X'01', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL)").run();
    raw.close();
    const reader = new TaskService({ dbPath: badNullable.dbPath });
    assert.throws(() => reader.getTaskList({ list_id: "bad-nullable" }, a), /Expected nullable string field assigned_to_agent_id/);
    reader.close();
  } finally {
    badNullable.cleanup();
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

    assert.deepEqual(service.getPrivateAccessEvents({}, b), []);
    assert.throws(
      () => service.getPrivateAccessEvents({ list_id: privateList.id }, b),
      (error) => error instanceof PrivateListAccessError,
    );

    const events = service.getPrivateAccessEvents({ list_id: privateList.id }, a);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.actor_agent_id, "agent-b");
    assert.equal(events[0]?.tool_name, "test");

    const filteredEvents = service.getPrivateAccessEvents({ actor_agent_id: "agent-b", tool_name: "test", since: "2026-01-01T00:00:00.000Z", limit: 1 }, a);
    assert.equal(filteredEvents.length, 1);

    assert.throws(
      () => service.getPrivateAccessEvents({ limit: 0 }, a),
      (error) => error instanceof ValidationError && error.message.includes("limit"),
    );
    assert.throws(
      () => service.getPrivateAccessEvents({ since: "not-a-date" }, a),
      (error) => error instanceof ValidationError && error.message.includes("since"),
    );
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
