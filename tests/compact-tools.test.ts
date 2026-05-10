import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compactToolAction, compactToolCallName, compactToolResultEnvelope, dispatchCompactTaskTool, formatCompactToolDisplay, getTaskHelp } from "../src/core/compact-tools.js";
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

test("compact tool display is concise for Pi while preserving full details separately", () => {
  assert.equal(
    formatCompactToolDisplay({
      operation: "task_lists.create",
      tool: "task_lists",
      action: "create",
      result: { name: "A list with\nspaces", visibility: "private" },
    }),
    "✓ Liste créée: A list with spaces · private",
  );

  assert.equal(formatCompactToolDisplay({ operation: "task_lists.find", result: [] }), "Aucune liste trouvée.");
  const foundOne = formatCompactToolDisplay({ operation: "task_lists.find", result: [{ name: "One", visibility: "shared", id: "one" }] });
  assert.equal(foundOne, "✓ 1 liste trouvée\n  NAME  VISIBILITY  ID\n• One   shared      one");
  const foundMany = formatCompactToolDisplay({
    operation: "task_lists.find",
    result: [
      { name: "Short", visibility: "private", id: "list-one" },
      { name: "Much longer list name", visibility: "shared", id: "list-two" },
    ],
  });
  const foundRows = foundMany.split("\n");
  assert.equal(foundRows[0], "✓ 2 listes trouvées");
  assert.equal(foundRows[1]?.includes("NAME"), true);
  assert.equal(foundRows[2]?.indexOf("private"), foundRows[3]?.indexOf("shared"));
  assert.equal(foundRows[2]?.indexOf("list-one"), foundRows[3]?.indexOf("list-two"));

  assert.equal(
    formatCompactToolDisplay({ operation: "task_lists.delete", result: { list: { name: "Gone", visibility: "shared" }, deleted_tasks: [] } }),
    "✓ Liste supprimée: Gone · shared · aucune tâche active",
  );
  assert.equal(
    formatCompactToolDisplay({ operation: "task_lists.delete", result: { list: { name: "Private gone", visibility: "private" }, deleted_tasks: [{}] } }),
    "✓ Liste supprimée: Private gone · private · 1 tâche supprimée",
  );
  assert.equal(
    formatCompactToolDisplay({ operation: "task_lists.delete", result: { list: { name: "Gone with tasks", visibility: "shared" }, deleted_tasks: [{}, {}] } }),
    "✓ Liste supprimée: Gone with tasks · shared · 2 tâches supprimées",
  );

  assert.equal(
    formatCompactToolDisplay({ operation: "task_help.workflow", result: { workflow: ["ignored verbose workflow"] } }),
    [
      "pi-tasks workflow",
      "1. Trouver/créer une liste: task_lists find/create",
      "2. Ajouter des tâches: task_items create/add_many",
      "3. Démarrer une tâche: task_claims claim_next",
      "4. Écrire la mémoire locale: task_items update notes",
      "5. Terminer: task_items update status=done + outcome",
    ].join("\n"),
  );

  const realNow = Date.now;
  Date.now = () => Date.parse("2026-01-01T00:00:00.000Z");
  try {
    assert.equal(formatCompactToolDisplay({ operation: "task_claims.claim_next", result: { task: null } }), "Aucune tâche disponible à claimer.");
    assert.equal(
      formatCompactToolDisplay({
        operation: "task_claims.claim_next",
        result: { task: { id: "123456789abcdef", position: 2, title: "Claim me", status: "in_progress", claim_expires_at: "2026-01-01T02:00:00.000Z" } },
      }),
      "▶ Tâche claimée: #2 Claim me\n  status: in_progress · expires: ~2h · id: 12345678",
    );
    assert.equal(
      formatCompactToolDisplay({
        operation: "task_claims.claim_next",
        result: { task: { id: "short", position: 3, title: "Soon", status: "in_progress", claim_expires_at: "2026-01-01T00:30:00.000Z" } },
      }).includes("expires: ~30m · id: short"),
      true,
    );
    assert.equal(
      formatCompactToolDisplay({
        operation: "task_claims.claim_next",
        result: { task: { id: "expired", position: 4, title: "Expired", status: "in_progress", claim_expires_at: "2025-12-31T23:59:00.000Z" } },
      }).includes("expires: expired"),
      true,
    );
    assert.equal(
      formatCompactToolDisplay({
        operation: "task_claims.claim_next",
        result: { task: { id: "invalid", position: 5, title: "Invalid", status: "in_progress", claim_expires_at: "not-a-date" } },
      }).includes("expires: ?"),
      true,
    );
    assert.equal(
      formatCompactToolDisplay({
        operation: "task_claims.claim_next",
        result: { task: { id: "missing", position: 6, title: "Missing", status: "in_progress", claim_expires_at: null } },
      }).includes("expires: ?"),
      true,
    );
  } finally {
    Date.now = realNow;
  }

  assert.equal(
    formatCompactToolDisplay({
      operation: "task_items.update",
      result: { id: "abcdef123456", position: 1, title: "Updated", status: "in_progress", notes: "line one\nline two", outcome: null },
    }),
    "✓ Tâche mise à jour: #1 Updated\n  status: in_progress · id: abcdef12\n  notes: line one line two",
  );
  assert.equal(
    formatCompactToolDisplay({
      operation: "task_items.update",
      result: { id: "done-task", position: 2, title: "Done", status: "done", notes: "", outcome: "Finished with a concise final outcome." },
    }),
    "✓ Tâche terminée: #2 Done\n  status: done · id: done-tas\n  outcome: Finished with a concise final outcome.",
  );
  assert.equal(
    formatCompactToolDisplay({ operation: "task_items.update", result: { id: "blocked-task", position: 3, title: "Blocked", status: "blocked", notes: "Waiting", outcome: null } }).startsWith(
      "⏸ Tâche bloquée: #3 Blocked",
    ),
    true,
  );
  assert.equal(
    formatCompactToolDisplay({ operation: "task_items.update", result: { id: "canceled-task", position: 4, title: "Canceled", status: "canceled", notes: null, outcome: null } }),
    "✕ Tâche annulée: #4 Canceled\n  status: canceled · id: canceled",
  );

  const added = formatCompactToolDisplay({
    operation: "task_items.add_many",
    tool: "task_items",
    action: "add_many",
    result: [
      { position: 1, title: "Short", description: null },
      { position: 2, title: "With description", description: "line one\nline two with a very long explanation that must be truncated before it wraps in Pi output" },
      "ignored corrupt row",
    ],
  });
  assert.equal(added.split("\n")[0], "✓ 3 tâches ajoutées");
  assert.equal(added.split("\n")[1], "#1 Short");
  assert.equal(added.split("\n")[2]?.includes("With description — line one line two"), true);
  assert.equal(added.split("\n")[2]?.endsWith("…"), true);
  assert.equal(added.split("\n")[2]!.length <= 96, true);

  assert.equal(
    formatCompactToolDisplay({ operation: "task_items.add_many", result: [{ position: 1, title: "One", description: "Only one" }] }),
    "✓ 1 tâche ajoutée\n#1 One — Only one",
  );
  assert.equal(formatCompactToolDisplay({ operation: "unknown", result: 1 }), JSON.stringify({ operation: "unknown", result: 1 }, null, 2));
  assert.equal(formatCompactToolDisplay("plain"), JSON.stringify("plain", null, 2));
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
