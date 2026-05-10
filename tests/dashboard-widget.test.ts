import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDashboard } from "../src/core/dashboard.js";
import { TaskService } from "../src/core/service.js";
import type { AccessOptions } from "../src/core/types.js";
import { formatDashboard, getTaskWidgetArgumentCompletions } from "../src/pi/dashboard-widget.js";

function tmpDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-widget-"));
  return { dbPath: join(dir, "tasks.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const access = (agentId: string): AccessOptions => ({ actor: { agentId, source: "test" } });

function assertFramedWidget(lines: string[], maxLines: number): void {
  assert.ok(lines.length <= maxLines, `expected <= ${maxLines} lines, got ${lines.length}`);
  assert.ok(lines.length >= 2);
  assert.equal(lines[0]?.startsWith("╭"), true);
  assert.equal(lines.at(-1)?.startsWith("╰"), true);
  assert.equal(new Set(lines.map((line) => line.length)).size, 1, "all frame lines should have equal string length");
}

test("task-widget command autocompletes supported actions", () => {
  assert.deepEqual(getTaskWidgetArgumentCompletions("f")?.map((item) => item.value), ["full"]);
  assert.deepEqual(getTaskWidgetArgumentCompletions("  c")?.map((item) => item.value), ["compact"]);
  assert.deepEqual(getTaskWidgetArgumentCompletions("")?.map((item) => item.value), ["on", "off", "compact", "full", "refresh"]);
  assert.equal(getTaskWidgetArgumentCompletions("compact "), null);
  assert.equal(getTaskWidgetArgumentCompletions("unknown"), null);
});

test("dashboard widget is framed and stays under Pi's 10-line widget limit", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = access("pi-session:75f25587c1936e24");

    service.createTaskList({ id: "example-list-1", name: "Example list 1", scope_type: "workspace", scope_key: "/repo", visibility: "shared" }, a);
    service.addManyTasks({ list_id: "example-list-1", tasks: [{ title: "analyser le besoin" }, { title: "proposer une solution" }] }, a);
    const done = service.claimNextTask({ list_id: "example-list-1" }, a).task;
    assert.ok(done);
    service.updateTask({ task_id: done.id, status: "done", outcome: "ok" }, a);
    const blocked = service.claimNextTask({ list_id: "example-list-1" }, a).task;
    assert.ok(blocked);
    service.updateTask({ task_id: blocked.id, status: "blocked" }, a);

    service.createTaskList({ id: "example-list-2", name: "Example list 2", scope_type: "workspace", scope_key: "/repo", visibility: "shared" }, a);
    service.addManyTasks(
      {
        list_id: "example-list-2",
        tasks: [
          { title: "préparer les fichiers" },
          { title: "exécuter les tests" },
          { title: "documenter le résultat" },
        ],
      },
      a,
    );
    const running = service.claimNextTask({ list_id: "example-list-2" }, a).task;
    assert.ok(running);

    service.createTaskList({ id: "empty-list", name: "Empty list", scope_type: "workspace", scope_key: "/repo", visibility: "shared" }, a);

    const dashboard = buildDashboard(service, a, { includeDone: true });
    const compact = formatDashboard(dashboard, "compact");
    const full = formatDashboard(dashboard, "full");

    assertFramedWidget(compact, 8);
    assertFramedWidget(full, 10);
    assert.ok(compact.some((line) => line.includes("moi · run 1 · todo 0 · paused 1")));
    assert.ok(compact.some((line) => line.includes("├─ listes")));
    assert.ok(full.some((line) => line.includes("Example list 2 · todo 2 · run 1 · blocked 0 · done 0")));
    assert.ok(full.some((line) => line.includes("paused")));

    service.close();
  } finally {
    cleanup();
  }
});
