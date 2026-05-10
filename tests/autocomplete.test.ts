import assert from "node:assert/strict";
import test from "node:test";
import { extractTasksListIdPrefix, taskListsToAutocompleteItems } from "../src/pi/autocomplete.js";
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

test("extracts /tasks list-id autocomplete prefix", () => {
  assert.equal(extractTasksListIdPrefix("/tasks "), "");
  assert.equal(extractTasksListIdPrefix("/tasks ex"), "ex");
  assert.equal(extractTasksListIdPrefix("/tasks example-list-2"), "example-list-2");
  assert.equal(extractTasksListIdPrefix("/tasks example-list-2 full"), undefined);
  assert.equal(extractTasksListIdPrefix("/task-list-delete ex"), "ex");
  assert.equal(extractTasksListIdPrefix("/task-lists ex"), undefined);
});

test("task list autocomplete returns matching ids with names as descriptions", () => {
  const items = taskListsToAutocompleteItems(
    [list("example-list-1", "Example list 1"), list("work-queue", "Important Work"), list("other", "Other")],
    "work",
  );
  assert.deepEqual(items.map((item) => item.value), ["work-queue"]);
  assert.equal(items[0]?.label, "work-queue");
  assert.equal(items[0]?.description, "Important Work · shared · workspace");
});
