import assert from "node:assert/strict";
import test from "node:test";
import { formatTaskListsCommandOutput } from "../src/pi/commands.js";
import type { TaskList } from "../src/core/types.js";

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
