import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { shortHash } from "../src/core/agent-id.js";
import { TaskService } from "../src/core/service.js";
import { createTaskListIdAutocompleteProvider, extractTasksListIdPrefix, registerPiTaskAutocomplete, taskListsToAutocompleteItems } from "../src/pi/autocomplete.js";
import type { AccessOptions, TaskList } from "../src/core/types.js";

function tmpCwd(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-autocomplete-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

const access = (agentId: string): AccessOptions => ({ actor: { agentId, source: "test" } });

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
  assert.equal(extractTasksListIdPrefix("/task-audit ex"), "ex");
  assert.equal(extractTasksListIdPrefix("/task-lists ex"), undefined);
});

test("task list autocomplete scores, sorts, filters, and limits matching lists", () => {
  const many = Array.from({ length: 25 }, (_, index) => list(`prefix-${index.toString().padStart(2, "0")}`, `Name ${index}`));
  const items = taskListsToAutocompleteItems(
    [
      list("exact", "Other"),
      list("exact-prefix", "Other"),
      list("id-contains-exact", "Other"),
      list("name-start", "Exact Name"),
      list("name-contains", "Contains Exact Value"),
      list("missing", "Missing"),
      ...many,
    ],
    "exact",
  );
  assert.deepEqual(items.map((item) => item.value), ["exact", "exact-prefix", "name-start", "id-contains-exact", "name-contains"]);
  assert.equal(items[0]?.label, "exact");
  assert.equal(items[0]?.description, "Other · shared · workspace");

  const limited = taskListsToAutocompleteItems(many, "prefix");
  assert.equal(limited.length, 20);
  assert.equal(taskListsToAutocompleteItems([list("anything", "Anything")], " ").length, 1);
});

test("registerPiTaskAutocomplete installs a provider only when UI is available", async () => {
  const handlers = new Map<string, any>();
  registerPiTaskAutocomplete({ on: (event: string, handler: any) => handlers.set(event, handler) } as any);

  let providerAdded = false;
  await handlers.get("session_start")({}, { hasUI: false, ui: { addAutocompleteProvider: () => { providerAdded = true; } } });
  assert.equal(providerAdded, false);

  await handlers.get("session_start")({}, { hasUI: true, cwd: process.cwd(), sessionManager: {}, ui: { addAutocompleteProvider: (wrap: any) => {
    providerAdded = true;
    const current = { getSuggestions: async () => null, applyCompletion: () => null };
    assert.equal(typeof wrap(current).getSuggestions, "function");
  } } });
  assert.equal(providerAdded, true);
});

test("task list autocomplete provider delegates, loads suggestions, handles aborts, and suppresses file completion", async () => {
  const { cwd, cleanup } = tmpCwd();
  const sessionFile = join(cwd, "session.json");
  const agentId = `pi-session:${shortHash(sessionFile)}`;
  try {
    const service = new TaskService({ cwd });
    service.createTaskList({ id: "example-list", name: "Example List", scope_type: "workspace", scope_key: cwd }, access(agentId));
    service.close();

    const delegatedSuggestions = { prefix: "", items: [{ value: "file.txt", label: "file.txt" }] };
    const current = {
      async getSuggestions() {
        return delegatedSuggestions;
      },
      applyCompletion(_lines: string[], _cursorLine: number, _cursorCol: number, item: any, prefix: string) {
        return { item, prefix };
      },
      shouldTriggerFileCompletion() {
        return true;
      },
    } as any;
    const ctx = { cwd, sessionManager: { getSessionFile: () => sessionFile } } as any;
    const provider = createTaskListIdAutocompleteProvider(current, ctx);

    assert.equal(await provider.getSuggestions([], 0, 0, { signal: new AbortController().signal } as any), delegatedSuggestions);
    assert.equal(await provider.getSuggestions(["plain"], 0, 5, { signal: new AbortController().signal } as any), delegatedSuggestions);
    const suggestions = await provider.getSuggestions(["/tasks ex"], 0, "/tasks ex".length, { signal: new AbortController().signal } as any);
    assert.deepEqual(suggestions?.items.map((item) => item.value), ["example-list"]);
    assert.equal(suggestions?.prefix, "ex");

    const aborted = new AbortController();
    aborted.abort();
    assert.equal(await provider.getSuggestions(["/tasks ex"], 0, "/tasks ex".length, { signal: aborted.signal } as any), delegatedSuggestions);
    assert.equal(await provider.getSuggestions(["/tasks missing"], 0, "/tasks missing".length, { signal: new AbortController().signal } as any), delegatedSuggestions);
    assert.deepEqual(provider.applyCompletion!(["/tasks ex"], 0, 9, { value: "example-list", label: "example-list" }, "ex"), {
      item: { value: "example-list", label: "example-list" },
      prefix: "ex",
    });
    assert.equal(provider.shouldTriggerFileCompletion!(["/tasks ex"], 0, "/tasks ex".length), false);
    assert.equal(provider.shouldTriggerFileCompletion!([], 0, 0), true);
    assert.equal(provider.shouldTriggerFileCompletion!(["plain"], 0, 5), true);

    const providerWithoutFileDelegate = createTaskListIdAutocompleteProvider({ getSuggestions: current.getSuggestions, applyCompletion: current.applyCompletion } as any, ctx);
    assert.equal(providerWithoutFileDelegate.shouldTriggerFileCompletion!(["plain"], 0, 5), true);

    const corruptDb = join(cwd, "corrupt", ".pi", "pi-tasks", "tasks.sqlite");
    const corruptService = new TaskService({ dbPath: corruptDb });
    corruptService.close();
    const raw = new DatabaseSync(corruptDb);
    raw.prepare("INSERT INTO task_lists VALUES ('bad', X'0102', 'workspace', '/repo', 'shared', NULL, 'agent', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)").run();
    raw.close();
    const badCtxProvider = createTaskListIdAutocompleteProvider(current, { cwd: join(cwd, "corrupt"), sessionManager: { getSessionFile: () => sessionFile } } as any);
    assert.equal(await badCtxProvider.getSuggestions(["/tasks ex"], 0, "/tasks ex".length, { signal: new AbortController().signal } as any), delegatedSuggestions);
  } finally {
    cleanup();
  }
});
