import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ClaimConflictError, NotFoundError, PiTasks, PrivateListAccessError, ValidationError } from "../src/index.js";

function tmpDb(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-public-test-"));
  return { dir, dbPath: join(dir, "tasks.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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

test("PiTasks public facade covers list/task lifecycle and compact dispatch", () => {
  const { dir, dbPath, cleanup } = tmpDb();
  let now = new Date("2026-01-01T00:00:00.000Z");
  const api = new PiTasks({ dbPath, agentId: "agent-a", source: "test", now: () => now });
  try {
    assert.equal(PiTasks.resolveDbPath(dir), resolve(dir, ".pi", "pi-tasks", "tasks.sqlite"));
    assert.deepEqual(api.getAgentSummary(), { db_path: dbPath, agent_id: "agent-a", source: "test" });

    const list = api.ensureTaskList({
      id: "parallel-agent-api-questions",
      name: "parallel questions: api",
      scope_type: "agent",
      scope_key: "api",
      visibility: "shared",
      owner_agent_id: "api",
    });
    assert.equal(list.id, "parallel-agent-api-questions");

    const updatedList = api.ensureTaskList({
      id: list.id,
      name: "parallel questions: api renamed",
      scope_type: "agent",
      scope_key: "api",
      visibility: "shared",
      owner_agent_id: "api",
      update_existing: true,
    });
    assert.equal(updatedList.name, "parallel questions: api renamed");
    assert.equal(api.findTaskLists().some((item) => item.id === list.id), true);
    assert.equal(api.findTaskLists({ scope_type: "agent" }).length, 1);
    assert.equal(api.getTaskList({ list_id: list.id }).list.id, list.id);

    const created = api.upsertTask({
      id: "question-1",
      list_id: list.id,
      title: "[incoming/queue] Should I update tests?",
      description: "Should I update tests?",
      notes: JSON.stringify({ parallelQuestionId: "question-1" }),
      assigned_to_agent_id: "parallel-child:api",
    });
    assert.equal(created.status, "todo");
    assert.equal(api.getTask("question-1").assigned_to_agent_id, "parallel-child:api");
    assert.equal(api.findTasks({ list_id: list.id, text: "update tests" }).length, 1);

    now = new Date("2026-01-01T01:00:00.000Z");
    const done = api.upsertTask({
      id: "question-1",
      list_id: list.id,
      title: "[incoming/queue] Should I update tests?",
      status: "done",
      outcome: "Answered: yes.",
    });
    assert.equal(done.status, "done");
    assert.equal(done.completed_at, "2026-01-01T01:00:00.000Z");

    assert.throws(
      () => api.upsertTask({ id: "bad-close", list_id: list.id, title: "bad", status: "done" }),
      (error) => error instanceof ValidationError && error.message.includes("outcome is required"),
    );

    api.createTask({ id: "claim-me", list_id: list.id, title: "claim me" });
    const claimed = api.claimNextTask({ list_id: list.id }).task;
    assert.equal(claimed?.id, "claim-me");
    assert.equal(api.refreshClaim({ task_id: "claim-me" }).id, "claim-me");
    assert.equal(api.updateTask({ task_id: "claim-me", status: "done", outcome: "finished" }).status, "done");

    const many = api.addManyTasks({
      list_id: list.id,
      tasks: [
        { id: "many-a", title: "many A" },
        { id: "many-b", title: "many B" },
      ],
    });
    assert.deepEqual(many.map((task) => task.id), ["many-a", "many-b"]);
    assert.deepEqual(api.reorderTasks({ list_id: list.id, task_ids: ["many-b", "many-a"] }).slice(0, 2).map((task) => task.id), ["many-b", "many-a"]);

    api.createTask({ id: "expire-me", list_id: list.id, title: "expire me" });
    api.claimNextTask({ list_id: list.id, claim_ttl_seconds: 1 });
    now = new Date("2026-01-01T01:00:02.000Z");
    assert.equal(api.releaseExpiredClaims().released.length, 1);
    assert.equal(api.releaseExpiredClaims({ list_id: list.id }).released.length, 0);

    assert.equal((api.getHelp().workflow as unknown[]).length > 0, true);
    assert.equal((api.getHelp("workflow").workflow as unknown[]).length > 0, true);
    assert.equal((api.dispatchCompactTool("task_lists", { action: "find", params: { scope_type: "agent" } }) as unknown[]).length, 1);

    const deleted = api.deleteTask("question-1");
    assert.ok(deleted.deleted_at);
    assert.throws(() => api.getTask("question-1"), NotFoundError);
    assert.equal(api.getTask({ task_id: "question-1", include_deleted: true }).id, "question-1");
    assert.ok(api.deleteTask({ task_id: "many-a" }).deleted_at);

    const deleteByObject = api.createTaskList({ id: "delete-by-object", name: "Delete by object", scope_type: "workspace", scope_key: "/repo" });
    assert.ok(api.deleteTaskList({ list_id: deleteByObject.id }).list.deleted_at);
    const deleteByString = api.createTaskList({ id: "delete-by-string", name: "Delete by string", scope_type: "workspace", scope_key: "/repo" });
    assert.ok(api.deleteTaskList(deleteByString.id).list.deleted_at);
  } finally {
    api.close();
    cleanup();
  }
});

test("PiTasks public facade covers natural keys, find filters, upsert edge cases, and actor defaults", () => {
  const { dbPath, cleanup } = tmpDb();
  const api = new PiTasks({ dbPath, agentId: "agent-a", source: "test" });
  try {
    const natural = api.ensureTaskList({ name: "Natural", scope_type: "workspace", scope_key: "/natural" });
    assert.equal(api.ensureTaskList({ name: "Natural", scope_type: "workspace", scope_key: "/natural" }).id, natural.id);
    const privateNatural = api.ensureTaskList({ name: "Private Natural", scope_type: "workspace", scope_key: "/natural", visibility: "private" });
    assert.equal(api.ensureTaskList({ name: "Private Natural", scope_type: "workspace", scope_key: "/natural", visibility: "private" }).id, privateNatural.id);

    api.deleteTaskList(natural.id);
    assert.throws(
      () => api.ensureTaskList({ id: natural.id, name: "Natural", scope_type: "workspace", scope_key: "/natural", revive_deleted: false }),
      NotFoundError,
    );
    assert.equal(api.ensureTaskList({ id: natural.id, name: "Natural", scope_type: "workspace", scope_key: "/natural", revive_deleted: true }).deleted_at, null);
    const defaultReviveList = api.createTaskList({ id: "default-revive-list", name: "Default Revive", scope_type: "workspace", scope_key: "/default-revive" });
    api.deleteTaskList(defaultReviveList.id);
    assert.equal(api.ensureTaskList({ id: defaultReviveList.id, name: "Default Revive", scope_type: "workspace", scope_key: "/default-revive" }).deleted_at, null);

    api.addManyTasks({
      list_id: natural.id,
      tasks: [
        { id: "todo-unassigned", title: "todo unassigned" },
        { id: "assigned", title: "assigned", assigned_to_agent_id: "agent-a" },
        { id: "claim-target", title: "claim target" },
      ],
    });
    assert.equal(api.findTasks().length >= 3, true);
    assert.equal(api.findTasks({ statuses: ["todo"], task_id: "assigned", assigned_to_agent_id: "agent-a", claimed_by_agent_id: null, limit: 5 })[0]?.id, "assigned");
    assert.equal(api.findTasks({ statuses: [] }).length >= 3, true);
    assert.equal(api.findTasks({ include_deleted: true }).length >= 3, true);
    assert.equal(api.findTasks({ assigned_to_agent_id: null }).some((task) => task.id === "todo-unassigned"), true);
    assert.equal(api.claimNextTask({ list_id: natural.id }).task?.id, "todo-unassigned");
    assert.equal(api.findTasks({ claimed_by_agent_id: "agent-a" })[0]?.id, "todo-unassigned");
    assert.equal(api.findTasks({ claimed_by_agent_id: null }).some((task) => task.id === "assigned"), true);
    const empty = tmpDb();
    try {
      const emptyApi = new PiTasks({ dbPath: empty.dbPath, agentId: "empty", source: "test" });
      assert.deepEqual(emptyApi.findTasks(), []);
      emptyApi.close();
    } finally {
      empty.cleanup();
    }
    assert.throws(() => api.findTasks({ statuses: ["invalid" as never] }), ValidationError);

    assert.throws(
      () => api.upsertTask({ id: "bad-progress", list_id: natural.id, title: "bad progress", status: "in_progress" as never }),
      ValidationError,
    );
    assert.equal(api.upsertTask({ id: "new-done", list_id: natural.id, title: "new done", status: "done", outcome: "done" }).status, "done");
    assert.equal(api.upsertTask({ id: "new-canceled", list_id: natural.id, title: "new canceled", status: "canceled", outcome: "canceled" }).status, "canceled");
    const otherList = api.createTaskList({ id: "other-list", name: "Other", scope_type: "workspace", scope_key: "/other" });
    api.upsertTask({ id: "move-me", list_id: natural.id, title: "move me" });
    assert.throws(() => api.upsertTask({ id: "move-me", list_id: otherList.id, title: "move me" }), ValidationError);
    assert.throws(() => api.upsertTask({ id: "move-me", list_id: natural.id, title: "move me", status: "done" }), ValidationError);

    const enriched = api.upsertTask({
      id: "move-me",
      list_id: natural.id,
      title: "move enriched",
      description: "desc",
      notes: "notes",
      assigned_to_agent_id: null,
      outcome: null,
    });
    assert.equal(enriched.description, "desc");
    assert.equal(api.upsertTask({ id: "move-me", list_id: natural.id, title: "move blocked", status: "blocked" }).status, "blocked");
    assert.equal(api.upsertTask({ id: "move-me", list_id: natural.id, title: "move todo", status: "todo" }).status, "todo");
    api.deleteTask("move-me");
    assert.throws(() => api.upsertTask({ id: "move-me", list_id: natural.id, title: "move deleted", revive_deleted: false }), NotFoundError);
    assert.equal(api.upsertTask({ id: "move-me", list_id: natural.id, title: "move revived", revive_deleted: true }).deleted_at, null);
    api.upsertTask({ id: "move-default", list_id: natural.id, title: "move default" });
    api.deleteTask("move-default");
    assert.equal(api.upsertTask({ id: "move-default", list_id: natural.id, title: "move default revived" }).deleted_at, null);

    const conflictList = api.createTaskList({ id: "conflict-list", name: "Conflict", scope_type: "workspace", scope_key: "/conflict" });
    api.createTask({ id: "claimed-conflict", list_id: conflictList.id, title: "claimed conflict" });
    api.claimNextTask({ list_id: conflictList.id }, { agentId: "agent-a", source: "test" });
    assert.equal(api.upsertTask({ id: "claimed-conflict", list_id: conflictList.id, title: "safe title edit" }, { agentId: "agent-b", source: "test" }).title, "safe title edit");
    assert.throws(
      () => api.upsertTask({ id: "claimed-conflict", list_id: conflictList.id, title: "claimed conflict", status: "done", outcome: "done" }, { agentId: "agent-b", source: "test" }),
      ClaimConflictError,
    );

    const inheritedSource = api.withActor("agent-c");
    assert.equal(inheritedSource.source, "test");
    inheritedSource.close();
  } finally {
    api.close();
    cleanup();
  }
});

test("PiTasks public facade resolves agent defaults from env and fallback", () => {
  const envDb = tmpDb();
  try {
    withEnv("PI_TASKS_AGENT_ID", " env-public ", () => {
      const api = new PiTasks({ dbPath: envDb.dbPath });
      try {
        assert.equal(api.agentId, "env-public");
        assert.equal(api.source, "unknown");
      } finally {
        api.close();
      }
    });
  } finally {
    envDb.cleanup();
  }

  const fallback = tmpDb();
  const previousCwd = process.cwd();
  try {
    withEnv("PI_TASKS_AGENT_ID", undefined, () => {
      process.chdir(fallback.dir);
      const api = new PiTasks();
      try {
        assert.equal(api.agentId.startsWith("pi-tasks-public:"), true);
        assert.equal(api.source, "unknown");
      } finally {
        api.close();
        process.chdir(previousCwd);
      }
    });
  } finally {
    process.chdir(previousCwd);
    fallback.cleanup();
  }
});

test("PiTasks public facade handles actor overrides and private bypass", () => {
  const { dbPath, cleanup } = tmpDb();
  const owner = new PiTasks({ dbPath, agentId: "owner-agent", source: "test" });
  const other = owner.withActor("other-agent", { source: "test" });
  const bypass = other.withPrivateBypass("confirmed by user", "public-test");
  try {
    const privateList = owner.createTaskList({
      id: "private-list",
      name: "Private",
      scope_type: "workspace",
      scope_key: "/repo",
      visibility: "private",
    });

    assert.throws(() => other.getTaskList(privateList.id), PrivateListAccessError);
    assert.equal(bypass.getTaskList(privateList.id).list.id, privateList.id);
    assert.equal(
      owner.getTaskList(privateList.id, {
        agentId: "option-agent",
        source: "test",
        privateBypass: { reason: "confirmed by option", toolName: "option-test" },
      }).list.id,
      privateList.id,
    );

    const events = owner.getPrivateAccessEvents({ list_id: privateList.id });
    assert.equal(events.length, 2);
    assert.equal(events.some((event) => event.actor_agent_id === "other-agent" && event.tool_name === "public-test"), true);
    assert.equal(events.some((event) => event.actor_agent_id === "option-agent" && event.tool_name === "option-test"), true);
    assert.equal(owner.getPrivateAccessEvents().length, 2);
  } finally {
    bypass.close();
    other.close();
    owner.close();
    cleanup();
  }
});
