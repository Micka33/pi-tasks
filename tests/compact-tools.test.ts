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
    formatCompactToolDisplay({ operation: "task_lists.get", result: { list: { name: "Empty", visibility: "private" }, tasks: [] } }),
    "Empty · private · aucune tâche",
  );
  assert.equal(
    formatCompactToolDisplay({ operation: "task_lists.get", result: { list: { name: "One", visibility: "shared" }, tasks: [{ position: 1, status: "todo", id: "abc", title: "Only one" }] } }),
    "One · shared · 1 tâche\ntodo 1\n\n  #  STATUS  ID   TITLE\n• 1  todo    abc  Only one",
  );
  const listedTasks = formatCompactToolDisplay({
    operation: "task_lists.get",
    result: {
      list: { name: "Task flow demo 2", visibility: "shared" },
      tasks: [
        { position: 1, status: "in_progress", id: "d813c1f6-9ecf-4b6f-abb4-d56084e83368", title: "Préparer les données" },
        { position: 2, status: "todo", id: "8d55eb15-e298-43d2-bd3b-b8403aa6e6c6", title: "Exécuter le traitement" },
        { position: 10, status: "done", id: "c5fbf6bf-769e-4e54-b7a8-989685ce0770", title: "A very very very long title that must be truncated before it can wrap in Pi output rows" },
        "ignored corrupt row",
      ],
    },
  });
  const listedRows = listedTasks.split("\n");
  assert.equal(listedRows[0], "Task flow demo 2 · shared · 3 tâches");
  assert.equal(listedRows[1], "todo 1 · run 1 · done 1");
  assert.equal(listedRows[3], "   #  STATUS  ID        TITLE");
  assert.equal(listedRows[4]?.startsWith("•  1  run     d813c1f6  Préparer les données"), true);
  assert.equal(listedRows[5]?.startsWith("•  2  todo    8d55eb15  Exécuter le traitement"), true);
  assert.equal(listedRows[6]?.startsWith("• 10  done    c5fbf6bf  A very very very long title"), true);
  assert.equal(listedRows[6]?.endsWith("…"), true);
  assert.equal(listedRows[6]!.length <= 96, true);

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

  assert.equal(
    formatCompactToolDisplay({
      operation: "task_items.create",
      result: { id: "created-task-id", position: 7, title: "Created", description: "with details", status: "todo" },
    }),
    "✓ Tâche créée: #7 Created — with details\n  status: todo · id: created-",
  );
  assert.equal(
    formatCompactToolDisplay({ operation: "task_items.delete", result: { id: "deleted-task-id", position: 8, title: "Deleted", status: "todo" } }),
    "✓ Tâche supprimée: #8 Deleted\n  status: todo · id: deleted-",
  );
  assert.equal(formatCompactToolDisplay({ operation: "task_items.reorder", result: [] }), "Aucune tâche réordonnée.");
  assert.equal(
    formatCompactToolDisplay({ operation: "task_items.reorder", result: [{ position: 1, id: "reorder-one", title: "One" }] }),
    "✓ 1 tâche réordonnée\n  #  ID        TITLE\n• 1  reorder-  One",
  );
  const reordered = formatCompactToolDisplay({
    operation: "task_items.reorder",
    result: [
      { position: 1, id: "reorder-one", title: "One" },
      { position: 22, id: "reorder-two", title: "A reordered task title that is intentionally very long so it must be truncated before wrapping" },
    ],
  });
  assert.equal(reordered.split("\n")[0], "✓ 2 tâches réordonnées");
  assert.equal(reordered.split("\n")[2]?.startsWith("•  1  reorder-  One"), true);
  assert.equal(reordered.split("\n")[3]?.endsWith("…"), true);

  const realNow2 = Date.now;
  Date.now = () => Date.parse("2026-01-01T00:00:00.000Z");
  try {
    assert.equal(
      formatCompactToolDisplay({
        operation: "task_claims.refresh",
        result: { id: "refresh-task-id", position: 2, title: "Refresh", status: "in_progress", claim_expires_at: "2026-01-01T01:00:00.000Z" },
      }),
      "✓ Claim rafraîchi: #2 Refresh\n  status: in_progress · expires: ~1h · id: refresh-",
    );
  } finally {
    Date.now = realNow2;
  }
  assert.equal(formatCompactToolDisplay({ operation: "task_claims.release_expired", result: {} }), "Aucun claim expiré à libérer.");
  assert.equal(
    formatCompactToolDisplay({ operation: "task_claims.release_expired", result: { released: [{ id: "released-one", position: 1, title: "Released one" }] } }),
    "✓ 1 claim expiré libéré\n• #1 Released one · id: released",
  );
  assert.equal(
    formatCompactToolDisplay({
      operation: "task_claims.release_expired",
      result: { released: [{ id: "released-one", position: 1, title: "Released one" }, { id: "released-two", position: 2, title: "Released two" }] },
    }).split("\n")[0],
    "✓ 2 claims expirés libérés",
  );

  assert.equal(formatCompactToolDisplay({ operation: "task_audit.get", result: [] }), "Private access audit\nAucun événement visible.");
  const auditOne = formatCompactToolDisplay({
    operation: "task_audit.get",
    result: [{ created_at: "2026-01-01T00:30:00.000Z", list_id: "private-list", actor_agent_id: "agent-b", tool_name: "task_lists.get", reason: "User confirmed bypass" }],
  });
  assert.equal(auditOne.includes("Private access audit · 1 événement"), true);
  assert.equal(auditOne.includes("reason: User confirmed bypass"), true);
  const auditMany = formatCompactToolDisplay({
    operation: "task_audit.get",
    result: [
      { created_at: "not-a-date", list_id: "list-1", actor_agent_id: "agent-1", tool_name: "task_lists.get", reason: 1 },
      { created_at: null, list_id: "list-2", actor_agent_id: "agent-2", tool_name: "task_items.update", reason: "ok" },
    ],
  });
  assert.equal(auditMany.includes("Private access audit · 2 événements"), true);
  assert.equal(auditMany.includes("• ?"), true);

  assert.equal(formatCompactToolDisplay({ operation: "task_help.all", result: {} }).startsWith("pi-tasks help\n• workflow"), true);
  assert.equal(formatCompactToolDisplay({ operation: "task_help.schemas", result: {} }).includes("• task_items: create, add_many, update, reorder, delete"), true);
  assert.equal(formatCompactToolDisplay({ operation: "task_help.examples", result: {} }), "pi-tasks examples\nAucun exemple disponible.");
  assert.equal(formatCompactToolDisplay({ operation: "task_help.examples", result: { examples: [] } }), "pi-tasks examples\nAucun exemple disponible.");
  assert.equal(
    formatCompactToolDisplay({
      operation: "task_help.examples",
      result: { examples: [{ tool: "task_lists", input: { action: "find" } }, { tool: "bad", input: { action: 1 } }, { tool: "none" }] },
    }),
    "pi-tasks examples\n1. task_lists find\n2. bad ?\n3. none ?",
  );

  assert.equal(
    formatCompactToolDisplay({ operation: "task_lists.create", result: { private_access_bypassed: true, result: { name: "Private", visibility: "private" } } }),
    "⚠ Accès privé confirmé\n✓ Liste créée: Private · private",
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
