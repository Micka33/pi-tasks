import assert from "node:assert/strict";
import test from "node:test";
import { formatTaskListDeleteCommandOutput, formatTaskListsCommandOutput, formatTasksCommandOutput } from "../src/pi/commands.js";
import type { Task, TaskList } from "../src/core/types.js";

const list = (id: string, name: string): TaskList => ({
  id,
  name,
  scope_type: "workspace",
  scope_key: "/repo",
  visibility: "shared",
  owner_agent_id: null,
  created_by_agent_id: "agent-a",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
});

const task = (overrides: Partial<Task>): Task => ({
  id: "task-1",
  list_id: "one",
  position: 1,
  title: "Do the thing",
  description: "Useful details.",
  notes: null,
  status: "done",
  assigned_to_agent_id: "agent-a",
  claimed_by_agent_id: null,
  claim_expires_at: null,
  outcome: "Implemented and tested.",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:10:00.000Z",
  started_at: "2026-01-01T00:01:00.000Z",
  completed_at: "2026-01-01T00:09:00.000Z",
  deleted_at: null,
  ...overrides,
});

test("/task-lists compact output shows only name and id", () => {
  const output = formatTaskListsCommandOutput([list("one", "One"), list("two", "Two")]);
  assert.equal(output, "- name: One\n  id: one\n- name: Two\n  id: two");
  assert.equal(output.includes("scope_type"), false);
  assert.equal(output.includes("visibility"), false);
});

test("/task-lists full output returns complete JSON", () => {
  const output = formatTaskListsCommandOutput([list("one", "One")], { full: true });
  assert.equal(output.includes('"scope_type": "workspace"'), true);
  assert.equal(output.includes('"id": "one"'), true);
});

test("/task-list-delete output summarizes deleted list and active task count", () => {
  const deletedList = list("one", "One");
  deletedList.deleted_at = "2026-01-01T00:20:00.000Z";
  const output = formatTaskListDeleteCommandOutput({ list: deletedList, deleted_tasks: [task({}), task({ id: "task-2" })] });
  assert.equal(
    output,
    "Deleted task list:\n- name: One\n  id: one\n  deleted_at: 2026-01-01T00:20:00.000Z\n  active tasks deleted: 2",
  );
});

test("/tasks readable output puts metadata first and shows outcome", () => {
  const output = formatTasksCommandOutput({ list: list("one", "One"), tasks: [task({})] }, "agent-a");
  assert.equal(output.includes("#1 ✓ done · Do the thing (task-1)"), true);
  assert.equal(output.includes("\n   assigned=me"), true);
  assert.equal(output.includes("\n   created=2026-01-01 00:00:00Z"), true);
  assert.equal(output.includes("\n   description:\n     Useful details."), true);
  assert.equal(output.includes("\n   outcome:\n     Implemented and tested."), true);
  assert.equal(output.includes("id: task-1"), false);
  assert.equal(output.includes("agent:"), false);
  assert.equal(output.includes("time:"), false);
  assert.equal(output.includes("meta:"), false);
  assert.equal(output.includes("status="), false);
  assert.equal(output.includes("position="), false);
  assert.equal(output.includes("result"), false);
});
