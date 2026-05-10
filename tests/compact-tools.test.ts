import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compactToolAction, compactToolCallName, compactToolResultEnvelope, dispatchCompactTaskTool, getTaskHelp } from "../src/core/compact-tools.js";
import { PrivateListAccessError, ValidationError } from "../src/core/errors.js";
import { TaskService } from "../src/core/service.js";
import type { AccessOptions } from "../src/core/types.js";

function tmpDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-compact-tools-"));
  return { dbPath: join(dir, "tasks.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const access = (agentId: string): AccessOptions => ({ actor: { agentId, source: "test" } });

test("compact task tools dispatch every action without legacy tool names", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const service = new TaskService({ dbPath, now: () => now });
    const a = access("agent-a");
    const b = access("agent-b");

    const list = dispatchCompactTaskTool(
      service,
      "task_lists",
      { action: "create", params: { id: "compact-list", name: "Compact", scope_type: "workspace", scope_key: "/repo" } },
      a,
    ) as { id: string };
    assert.equal(list.id, "compact-list");
    assert.equal((dispatchCompactTaskTool(service, "task_lists", { action: "find", params: { name: "compact" } }, a) as unknown[]).length, 1);

    const first = dispatchCompactTaskTool(
      service,
      "task_items",
      { action: "create", params: { id: "first", list_id: list.id, title: "First" } },
      a,
    ) as { id: string };
    assert.equal(first.id, "first");
    const many = dispatchCompactTaskTool(
      service,
      "task_items",
      { action: "add_many", params: { list_id: list.id, tasks: [{ id: "second", title: "Second" }, { id: "third", title: "Third" }] } },
      a,
    ) as Array<{ id: string }>;
    assert.deepEqual(many.map((task) => task.id), ["second", "third"]);

    const claimed = dispatchCompactTaskTool(
      service,
      "task_claims",
      { action: "claim_next", params: { list_id: list.id, claim_ttl_seconds: 1 } },
      a,
    ) as { task: { id: string } | null };
    assert.equal(claimed.task?.id, "first");
    const refreshed = dispatchCompactTaskTool(
      service,
      "task_claims",
      { action: "refresh", params: { task_id: "first", claim_ttl_seconds: 2 } },
      a,
    ) as { id: string };
    assert.equal(refreshed.id, "first");
    const done = dispatchCompactTaskTool(
      service,
      "task_items",
      { action: "update", params: { task_id: "first", status: "done", outcome: "Decision: done. Actions: tested. Final state: ok." } },
      a,
    ) as { status: string };
    assert.equal(done.status, "done");

    dispatchCompactTaskTool(service, "task_items", { action: "reorder", params: { list_id: list.id, task_ids: ["third", "second"] } }, a);
    const ordered = dispatchCompactTaskTool(service, "task_lists", { action: "get", params: { list_id: list.id } }, a) as { tasks: Array<{ id: string }> };
    assert.deepEqual(ordered.tasks.map((task) => task.id), ["third", "second", "first"]);

    const claimedSecond = dispatchCompactTaskTool(
      service,
      "task_claims",
      { action: "claim_next", params: { list_id: list.id, claim_ttl_seconds: 1 } },
      a,
    ) as { task: { id: string } | null };
    assert.equal(claimedSecond.task?.id, "third");
    now = new Date("2026-01-01T00:00:02.000Z");
    const released = dispatchCompactTaskTool(service, "task_claims", { action: "release_expired", params: { list_id: list.id } }, a) as { released: unknown[] };
    assert.equal(released.released.length, 1);

    const deletedTask = dispatchCompactTaskTool(service, "task_items", { action: "delete", params: { task_id: "second" } }, a) as { deleted_at: string | null };
    assert.ok(deletedTask.deleted_at);

    const privateList = dispatchCompactTaskTool(
      service,
      "task_lists",
      { action: "create", params: { id: "private", name: "Private", scope_type: "workspace", scope_key: "/repo", visibility: "private" } },
      a,
    ) as { id: string };
    assert.throws(
      () => dispatchCompactTaskTool(service, "task_lists", { action: "get", params: { list_id: privateList.id } }, b),
      PrivateListAccessError,
    );
    dispatchCompactTaskTool(
      service,
      "task_lists",
      { action: "get", params: { list_id: privateList.id } },
      { ...b, privateBypass: { toolName: "task_lists.get", reason: "confirmed" } },
    );
    const audit = dispatchCompactTaskTool(service, "task_audit", { action: "get", params: { list_id: privateList.id } }, a) as unknown[];
    assert.equal(audit.length, 1);

    const deletedList = dispatchCompactTaskTool(service, "task_lists", { action: "delete", params: { list_id: list.id } }, a) as { list: { deleted_at: string | null } };
    assert.ok(deletedList.list.deleted_at);

    service.close();
  } finally {
    cleanup();
  }
});

test("compact task help returns workflow, schemas, examples, and all sections", () => {
  assert.equal((getTaskHelp(undefined).workflow as unknown[]).length > 0, true);
  assert.equal((getTaskHelp({}).schemas as Record<string, unknown>).task_lists !== undefined, true);
  assert.equal((getTaskHelp({ action: "workflow" }).workflow as string[])[0]?.includes("task_lists"), true);
  assert.equal((getTaskHelp({ action: "schemas" }).schemas as Record<string, unknown>).task_items !== undefined, true);
  assert.equal(Array.isArray(getTaskHelp({ action: "examples" }).examples), true);

  const dispatched = dispatchCompactTaskTool({} as TaskService, "task_help", { action: "examples" }, access("agent-a")) as { examples: unknown[] };
  assert.equal(dispatched.examples.length > 0, true);
});

test("compact task tools validate tool names, actions, params, and help input", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = access("agent-a");

    assert.equal(compactToolAction("task_items", { action: "add_many" }), "add_many");
    assert.equal(compactToolAction("task_help", undefined), "all");
    assert.equal(compactToolAction("task_help", {}), "all");
    assert.equal(compactToolAction("task_help", { action: "" }), undefined);
    assert.equal(compactToolAction("task_lists", { action: 1 }), undefined);
    assert.equal(compactToolCallName("task_lists", { action: "get" }), "task_lists.get");
    assert.equal(compactToolCallName("task_help", undefined), "task_help.all");
    assert.equal(compactToolCallName("task_help", {}), "task_help.all");
    assert.equal(compactToolCallName("task_lists", { action: 1 }), "task_lists");
    assert.equal(compactToolCallName("task_lists", null), "task_lists");
    assert.deepEqual(compactToolResultEnvelope("task_items", { action: "add_many" }, ["x"]), {
      operation: "task_items.add_many",
      tool: "task_items",
      action: "add_many",
      result: ["x"],
    });
    assert.deepEqual(compactToolResultEnvelope("task_lists", {}, "ok"), {
      operation: "task_lists",
      tool: "task_lists",
      result: "ok",
    });

    assert.throws(() => dispatchCompactTaskTool(service, "unknown", { action: "get" }, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_lists", null, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_lists", [], a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_lists", { params: {} }, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_lists", { action: " ", params: {} }, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_lists", { action: "missing", params: {} }, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_items", { action: "missing", params: {} }, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_claims", { action: "missing", params: {} }, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_audit", { action: "missing", params: {} }, a), ValidationError);
    assert.throws(() => dispatchCompactTaskTool(service, "task_lists", { action: "find", params: [] }, a), ValidationError);
    assert.throws(() => getTaskHelp(null), ValidationError);
    assert.throws(() => getTaskHelp([]), ValidationError);
    assert.throws(() => getTaskHelp({ action: "" }), ValidationError);
    assert.throws(() => getTaskHelp({ action: "unknown" }), ValidationError);

    service.close();
  } finally {
    cleanup();
  }
});
