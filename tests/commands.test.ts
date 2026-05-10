import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { shortHash } from "../src/core/agent-id.js";
import { PrivateListAccessError } from "../src/core/errors.js";
import { TaskService } from "../src/core/service.js";
import { formatTaskAuditCommandOutput, formatTaskListDeleteCommandOutput, formatTaskListsCommandOutput, formatTasksCommandOutput, registerPiTaskCommands } from "../src/pi/commands.js";
import type { AccessOptions, PrivateAccessEvent, Task, TaskList } from "../src/core/types.js";

function tmpCwd(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-commands-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

const access = (agentId: string): AccessOptions => ({ actor: { agentId, source: "test" } });

function mockCommandContext(cwd: string, options: { hasUI?: boolean; confirm?: boolean; sessionFile?: string } = {}) {
  const notifications: Array<{ message: string; level: string }> = [];
  const confirmations: Array<{ title: string; message: string }> = [];
  return {
    ctx: {
      cwd,
      hasUI: options.hasUI ?? true,
      sessionManager: { getSessionFile: () => options.sessionFile ?? join(cwd, "session.json") },
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
        async confirm(title: string, message: string) {
          confirmations.push({ title, message });
          return options.confirm ?? true;
        },
      },
    } as any,
    notifications,
    confirmations,
  };
}

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

const auditEvent = (overrides: Partial<PrivateAccessEvent> = {}): PrivateAccessEvent => ({
  id: "event-1",
  list_id: "private-list",
  actor_agent_id: "agent-b",
  tool_name: "task_list_get",
  reason: "User confirmed bypass",
  created_at: "2026-01-01T00:30:00.000Z",
  ...overrides,
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
  assert.equal(formatTaskListsCommandOutput([]), "No visible task lists.");
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
  assert.equal(formatTaskListDeleteCommandOutput({ list: list("already", "Already"), deleted_tasks: [] }).includes("already deleted"), true);
});

test("/task-audit output is readable and handles empty results", () => {
  assert.equal(formatTaskAuditCommandOutput([]), "Private access audit\nNo visible private access events.");

  const output = formatTaskAuditCommandOutput([auditEvent()]);
  assert.equal(
    output,
    "Private access audit\n\n2026-01-01 00:30:00Z · list=private-list · actor=agent-b · tool=task_list_get\n  reason: User confirmed bypass",
  );
});

test("registered Pi task commands handle readable, JSON, usage, and bypass paths", async () => {
  const { cwd, cleanup } = tmpCwd();
  const sessionFile = join(cwd, "session.json");
  const agentId = `pi-session:${shortHash(sessionFile)}`;
  try {
    const service = new TaskService({ cwd });
    const current = access(agentId);
    const other = access("other-agent");
    const shared = service.createTaskList({ id: "shared-list", name: "Shared List", scope_type: "workspace", scope_key: cwd }, current);
    service.createTask({ id: "shared-task", list_id: shared.id, title: "Shared task" }, current);
    const privateList = service.createTaskList({ id: "private-list", name: "Private List", scope_type: "workspace", scope_key: cwd, visibility: "private" }, other);
    const ownerlessPrivate = service.createTaskList({ id: "ownerless-private", name: "Ownerless Private", scope_type: "workspace", scope_key: cwd, visibility: "private", owner_agent_id: null }, other);
    service.close();

    const commands = new Map<string, any>();
    registerPiTaskCommands({ registerCommand: (name: string, definition: any) => commands.set(name, definition) } as any);
    assert.deepEqual([...commands.keys()], ["task-store", "task-agent", "task-lists", "tasks", "task-list-delete", "task-audit"]);

    const base = mockCommandContext(cwd, { sessionFile });
    await commands.get("task-store").handler("", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes('"agent_id": "pi-session:'), true);

    const warningCtx = mockCommandContext(cwd, { sessionFile: undefined });
    warningCtx.ctx.sessionManager = {};
    await commands.get("task-store").handler("", warningCtx.ctx);
    await commands.get("task-agent").handler("", warningCtx.ctx);
    await commands.get("task-lists").handler("", warningCtx.ctx);
    assert.equal(warningCtx.notifications.filter((item) => item.level === "warning").length >= 3, true);

    await commands.get("task-agent").handler("", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, agentId);

    await commands.get("task-lists").handler("bad", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, "Usage: /task-lists [full]");
    await commands.get("task-lists").handler("", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes("Shared List"), true);
    await commands.get("task-lists").handler("json", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, "Usage: /task-lists [full]");
    await commands.get("task-lists").handler("--full", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes('"scope_type"'), true);

    await commands.get("tasks").handler("", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, "Usage: /tasks <list_id> [full]");
    await commands.get("tasks").handler("shared-list", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes("Shared task"), true);
    await commands.get("tasks").handler("shared-list json", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes('"tasks"'), true);
    await commands.get("tasks").handler("shared-list nope", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, "Usage: /tasks <list_id> [full]");
    await assert.rejects(() => commands.get("tasks").handler("missing-list", base.ctx));

    const denied = mockCommandContext(cwd, { sessionFile, confirm: false });
    await assert.rejects(() => commands.get("tasks").handler(privateList.id, denied.ctx), PrivateListAccessError);
    assert.equal(denied.confirmations.length, 1);

    const noUi = mockCommandContext(cwd, { sessionFile, hasUI: false });
    await assert.rejects(() => commands.get("tasks").handler(privateList.id, noUi.ctx), PrivateListAccessError);

    await commands.get("tasks").handler(privateList.id, base.ctx);
    assert.equal(base.confirmations.length, 1);
    assert.equal(base.notifications.at(-1)?.message.includes("Private List"), true);
    await commands.get("tasks").handler(ownerlessPrivate.id, base.ctx);
    assert.equal(base.confirmations.at(-1)?.message.includes("Owner: <none>"), true);

    await commands.get("task-audit").handler("too many args", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, "Usage: /task-audit [list_id] [full]");
    await commands.get("task-audit").handler("", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes("Private access audit"), true);
    await commands.get("task-audit").handler("shared-list", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes("Private access audit"), true);
    await commands.get("task-audit").handler("full", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.startsWith("["), true);
    await commands.get("task-audit").handler(`${privateList.id} full`, base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes('"tool_name": "/tasks"'), true);

    await commands.get("task-list-delete").handler("", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, "Usage: /task-list-delete <list_id>");
    await commands.get("task-list-delete").handler("two words", base.ctx);
    assert.equal(base.notifications.at(-1)?.message, "Usage: /task-list-delete <list_id>");
    await commands.get("task-list-delete").handler("shared-list", base.ctx);
    assert.equal(base.notifications.at(-1)?.message.includes("Deleted task list:"), true);
  } finally {
    cleanup();
  }
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

test("/tasks readable output covers empty lists, statuses, agents, timing, and text blocks", () => {
  const empty = formatTasksCommandOutput({ list: list("empty", "Empty"), tasks: [] }, "agent-a");
  assert.equal(empty.includes("No tasks in this list."), true);

  const soon = new Date(Date.now() + 30_000).toISOString();
  const future = new Date(Date.now() + 90_000).toISOString();
  const farFuture = new Date(Date.now() + 125 * 60_000).toISOString();
  const exactHours = new Date(Date.now() + 2 * 60 * 60_000 + 5_000).toISOString();
  const past = new Date(Date.now() - 90_000).toISOString();
  const output = formatTasksCommandOutput(
    {
      list: list("many", "Many"),
      tasks: [
        task({ id: "todo", position: 1, status: "todo", title: "Todo", assigned_to_agent_id: null, description: "line 1\nline 2", outcome: null }),
        task({ id: "run", position: 2, status: "in_progress", title: "Run", claimed_by_agent_id: null, claim_expires_at: future, outcome: null }),
        task({ id: "soon", position: 8, status: "in_progress", title: "Soon", claim_expires_at: soon, outcome: null }),
        task({ id: "blocked", position: 3, status: "blocked", title: "Blocked", assigned_to_agent_id: "agent-b", notes: "note", outcome: null }),
        task({ id: "canceled", position: 4, status: "canceled", title: "Canceled", completed_at: "2026-01-01T00:12:00.000Z", outcome: "Canceled cleanly." }),
        task({ id: "expired", position: 5, status: "in_progress", title: "Expired", claim_expires_at: past, outcome: null }),
        task({ id: "far", position: 6, status: "in_progress", title: "Far", claim_expires_at: farFuture, outcome: null }),
        task({ id: "bad-time", position: 7, status: "in_progress", title: "Bad Time", claim_expires_at: "not-a-date", outcome: null }),
        task({ id: "exact-hours", position: 9, status: "in_progress", title: "Exact Hours", claim_expires_at: exactHours, outcome: null }),
      ],
    },
    "agent-a",
  );

  assert.equal(output.includes("#1 ○ todo · Todo"), true);
  assert.equal(output.includes("#2 ▶ run · Run"), true);
  assert.equal(output.includes("claimed=none"), true);
  assert.match(output, /expires=\d+s/);
  assert.equal(output.includes("expires=1m"), true);
  assert.equal(output.includes("#3 ■ paused · Blocked"), true);
  assert.equal(output.includes("assigned=agent-b"), true);
  assert.equal(output.includes("notes:\n     note"), true);
  assert.equal(output.includes("#4 × canceled · Canceled"), true);
  assert.equal(output.includes("completed=2026-01-01 00:12:00Z"), true);
  assert.equal(output.includes("expires=-1m"), true);
  assert.match(output, /expires=2h\d+m/);
  assert.equal(output.includes("expires=2h"), true);
  assert.equal(output.includes("expires=not-a-date"), true);
});
