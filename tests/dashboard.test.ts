import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDashboard } from "../src/core/dashboard.js";
import { TaskService } from "../src/core/service.js";
import type { AccessOptions } from "../src/core/types.js";

function tmpDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-dashboard-"));
  return { dbPath: join(dir, "tasks.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const access = (agentId: string): AccessOptions => ({ actor: { agentId, source: "test" } });

test("dashboard summarizes visible lists and current-agent tasks without private bypass", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const service = new TaskService({ dbPath });
    const a = access("agent-a");
    const b = access("agent-b");

    service.createTaskList({ id: "shared", name: "Shared", scope_type: "workspace", scope_key: "/repo", visibility: "shared" }, a);
    service.addManyTasks(
      {
        list_id: "shared",
        tasks: [
          { title: "assigned", assigned_to_agent_id: "agent-a" },
          { title: "unassigned" },
          { title: "other", assigned_to_agent_id: "agent-b" },
        ],
      },
      a,
    );
    const claimed = service.claimNextTask({ list_id: "shared" }, b).task;
    assert.ok(claimed);

    service.createTaskList(
      { id: "private", name: "Private", scope_type: "workspace", scope_key: "/repo", visibility: "private", owner_agent_id: "agent-b" },
      b,
    );
    service.createTask({ list_id: "private", title: "hidden" }, b);

    const dashboardA = buildDashboard(service, a);
    assert.equal(dashboardA.lists.length, 1);
    assert.equal(dashboardA.lists[0]?.list.id, "shared");
    assert.equal(dashboardA.counts.todo, 2);
    assert.equal(dashboardA.counts.in_progress, 1);
    assert.equal(dashboardA.myCounts.todo, 1);
    assert.equal(dashboardA.myTasks.length, 1);
    assert.equal(dashboardA.myTasks[0]?.task.title, "assigned");

    const dashboardB = buildDashboard(service, b);
    assert.equal(dashboardB.lists.length, 2);
    assert.equal(dashboardB.myCounts.in_progress, 1);
    assert.equal(dashboardB.myTasks.some((item) => item.task.id === claimed.id), true);

    service.close();
  } finally {
    cleanup();
  }
});
