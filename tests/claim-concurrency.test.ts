import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TaskService } from "../src/core/service.js";
import type { AccessOptions } from "../src/core/types.js";

function tmpDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-concurrency-"));
  return { dbPath: join(dir, "tasks.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const access = (agentId: string): AccessOptions => ({ actor: { agentId, source: "test" } });

test("separate SQLite connections do not claim the same task", async () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const setup = new TaskService({ dbPath });
    setup.createTaskList({ id: "queue", name: "Queue", scope_type: "workspace", scope_key: "/repo", visibility: "shared" }, access("owner"));
    setup.addManyTasks(
      { list_id: "queue", tasks: [{ title: "a" }, { title: "b" }, { title: "c" }] },
      access("owner"),
    );
    setup.close();

    const claimFrom = async (agentId: string) => {
      await new Promise((resolve) => setImmediate(resolve));
      const service = new TaskService({ dbPath });
      try {
        return service.claimNextTask({ list_id: "queue" }, access(agentId)).task;
      } finally {
        service.close();
      }
    };

    const claimed = await Promise.all([claimFrom("agent-1"), claimFrom("agent-2"), claimFrom("agent-3")]);
    const ids = claimed.map((task) => task?.id);
    assert.equal(new Set(ids).size, 3);
    assert.ok(claimed.every((task) => task?.status === "in_progress"));
  } finally {
    cleanup();
  }
});

test("data persists across service instances", () => {
  const { dbPath, cleanup } = tmpDb();
  try {
    const first = new TaskService({ dbPath });
    first.createTaskList({ id: "persist", name: "Persist", scope_type: "workspace", scope_key: "/repo", visibility: "shared" }, access("agent"));
    first.createTask({ list_id: "persist", title: "survives" }, access("agent"));
    first.close();

    const second = new TaskService({ dbPath });
    const list = second.getTaskList({ list_id: "persist" }, access("agent"));
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0]?.title, "survives");
    second.close();
  } finally {
    cleanup();
  }
});
