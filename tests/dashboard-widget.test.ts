import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { shortHash } from "../src/core/agent-id.js";
import { buildDashboard, emptyCounts, type DashboardData } from "../src/core/dashboard.js";
import { TaskService } from "../src/core/service.js";
import type { AccessOptions, Task, TaskList, TaskStatus } from "../src/core/types.js";
import { formatDashboard, getTaskWidgetArgumentCompletions, registerPiTasksDashboardWidget } from "../src/pi/dashboard-widget.js";

function tmpDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-widget-"));
  return { dbPath: join(dir, "tasks.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function tmpCwd(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-widget-cwd-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

function mockWidgetContext(cwd: string, options: { hasUI?: boolean; sessionFile?: string; sessionManager?: unknown } = {}) {
  const widgets: Array<{ key: string; value: string[] | undefined; options?: unknown }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    ctx: {
      cwd,
      hasUI: options.hasUI ?? true,
      sessionManager: options.sessionManager ?? { getSessionFile: () => options.sessionFile ?? join(cwd, "session.json") },
      ui: {
        setWidget(key: string, value: string[] | undefined, widgetOptions?: unknown) {
          widgets.push({ key, value, options: widgetOptions });
        },
        setStatus(key: string, value: string | undefined) {
          statuses.push({ key, value });
        },
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as any,
    widgets,
    statuses,
    notifications,
  };
}

const access = (agentId: string): AccessOptions => ({ actor: { agentId, source: "test" } });

const widgetList = (id: string, name = id): TaskList => ({
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

const widgetTask = (overrides: Partial<Task>): Task => ({
  id: "task",
  list_id: "list",
  position: 1,
  title: "Task",
  description: null,
  notes: null,
  status: "todo",
  assigned_to_agent_id: null,
  claimed_by_agent_id: null,
  claim_expires_at: null,
  outcome: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  started_at: null,
  completed_at: null,
  deleted_at: null,
  ...overrides,
});

function dashboardFromLists(agentId: string, lists: Array<{ list: TaskList; tasks: Task[] }>): DashboardData {
  const counts = emptyCounts();
  const myCounts = emptyCounts();
  const dashboardLists = lists.map(({ list, tasks }) => {
    const listCounts = emptyCounts();
    const myTasks = [];
    for (const task of tasks) {
      listCounts[task.status] += 1;
      counts[task.status] += 1;
      const assignedToAgent = task.assigned_to_agent_id === agentId;
      const claimedByAgent = task.claimed_by_agent_id === agentId;
      if (assignedToAgent || claimedByAgent) {
        const dashboardTask = { task, list, assignedToAgent, claimedByAgent };
        myTasks.push(dashboardTask);
        myCounts[task.status] += 1;
      }
    }
    return { list, tasks, counts: listCounts, myTasks, totalActiveTasks: tasks.length };
  });
  return {
    agentId,
    lists: dashboardLists,
    counts,
    myCounts,
    myTasks: dashboardLists.flatMap((list) => list.myTasks),
    totalActiveTasks: lists.reduce((sum, item) => sum + item.tasks.length, 0),
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

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

test("registered dashboard widget handles events, commands, empty data, errors, and shutdown", async () => {
  const { cwd, cleanup } = tmpCwd();
  const sessionFile = join(cwd, "session.json");
  const agentId = `pi-session:${shortHash(sessionFile)}`;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  try {
    globalThis.setInterval = ((handler: Parameters<typeof setInterval>[0]) => {
      if (typeof handler === "function") handler();
      return { unref() {} } as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = (() => undefined) as typeof clearInterval;

    const handlers = new Map<string, any>();
    const commands = new Map<string, any>();
    registerPiTasksDashboardWidget({
      on: (event: string, handler: any) => handlers.set(event, handler),
      registerCommand: (name: string, definition: any) => commands.set(name, definition),
    } as any);

    const noUi = mockWidgetContext(cwd, { hasUI: false, sessionFile });
    await handlers.get("session_start")({}, noUi.ctx);
    await handlers.get("session_tree")({}, noUi.ctx);
    await handlers.get("tool_execution_end")({ toolName: "task_items" }, noUi.ctx);
    assert.equal(noUi.widgets.length, 0);

    const warningCtx = mockWidgetContext(cwd, { sessionManager: {} });
    await handlers.get("session_start")({}, warningCtx.ctx);
    assert.equal(warningCtx.notifications.some((item) => item.level === "warning"), true);
    assert.equal(warningCtx.widgets.at(-1)?.value, undefined);
    assert.equal(warningCtx.statuses.at(-1)?.value, undefined);
    await commands.get("task-widget").handler("refresh", warningCtx.ctx);
    assert.equal(warningCtx.notifications.at(-1)?.message, "pi-tasks widget: no visible task lists");

    const service = new TaskService({ cwd });
    service.createTaskList({ id: "widget-list", name: "Widget List", scope_type: "workspace", scope_key: cwd }, access(agentId));
    service.createTask({ id: "widget-task", list_id: "widget-list", title: "Widget task" }, access(agentId));
    service.close();

    const ctx = mockWidgetContext(cwd, { sessionFile });
    await handlers.get("tool_execution_end")({ toolName: "not_task" }, ctx.ctx);
    assert.equal(ctx.widgets.length, 0);
    await handlers.get("session_tree")({}, ctx.ctx);
    assert.equal(ctx.widgets.at(-1)?.key, "pi-tasks");
    await handlers.get("tool_execution_end")({ toolName: "task_items" }, ctx.ctx);
    assert.equal(ctx.widgets.at(-1)?.key, "pi-tasks");
    assert.deepEqual(ctx.widgets.at(-1)?.options, { placement: "aboveEditor" });
    assert.equal(ctx.statuses.at(-1)?.value?.startsWith("tasks run"), true);

    await commands.get("task-widget").handler("bad", ctx.ctx);
    assert.equal(ctx.notifications.at(-1)?.message, "Usage: /task-widget on|off|compact|full|refresh");
    await commands.get("task-widget").handler("full", ctx.ctx);
    assert.equal(ctx.notifications.at(-1)?.message, "pi-tasks widget refreshed (full)");
    await commands.get("task-widget").handler("compact", ctx.ctx);
    assert.equal(ctx.notifications.at(-1)?.message, "pi-tasks widget refreshed (compact)");
    await commands.get("task-widget").handler("", ctx.ctx);
    assert.equal(ctx.notifications.at(-1)?.message, "pi-tasks widget refreshed (compact)");
    await commands.get("task-widget").handler("off", ctx.ctx);
    assert.equal(ctx.notifications.at(-1)?.message, "pi-tasks widget disabled for this session");
    await handlers.get("session_start")({}, ctx.ctx);
    await commands.get("task-widget").handler("on", ctx.ctx);
    assert.equal(ctx.notifications.at(-1)?.message, "pi-tasks widget refreshed (compact)");

    const badCwd = join(cwd, "file-instead-of-directory");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(badCwd, "not a directory"));
    const errorCtx = mockWidgetContext(badCwd, { sessionFile: join(badCwd, "session.json") });
    await commands.get("task-widget").handler("refresh", errorCtx.ctx);
    assert.equal(errorCtx.statuses.at(-1)?.value, "pi-tasks: error");
    assert.equal(errorCtx.notifications.at(-1)?.level, "error");

    const stringErrorCtx = mockWidgetContext(cwd, { sessionFile });
    stringErrorCtx.ctx.ui.setWidget = () => { throw "string refresh failure"; };
    await commands.get("task-widget").handler("refresh", stringErrorCtx.ctx);
    assert.equal(stringErrorCtx.notifications.at(-1)?.message.includes("string refresh failure"), true);

    await handlers.get("session_shutdown")({}, ctx.ctx);
    assert.equal(ctx.widgets.at(-1)?.value, undefined);
    assert.equal(ctx.statuses.at(-1)?.value, undefined);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    cleanup();
  }
});

test("formatDashboard covers empty, hidden, long, duration, and status variants", () => {
  const empty = dashboardFromLists("short-agent", []);
  assert.equal(formatDashboard(empty, "compact").some((line) => line.includes("aucune tâche visible")), true);
  assert.equal(formatDashboard(empty, "full").some((line) => line.includes("0 lists · 0 tasks")), true);

  const onlyEmptyList = dashboardFromLists("short-agent", [{ list: widgetList("empty-only", "Empty Only"), tasks: [] }]);
  assert.equal(formatDashboard(onlyEmptyList, "compact").some((line) => line.includes("Empty Only · aucune tâche")), true);
  assert.equal(formatDashboard(onlyEmptyList, "full").some((line) => line.includes("Empty Only · aucune tâche")), true);
  assert.equal(formatDashboard(onlyEmptyList, "compact").some((line) => line.includes("aucune tâche visible")), false);

  const agentId = "very-long-agent-id-for-widget";
  const listA = widgetList("list-a", "List A");
  const listB = widgetList("list-b", "List B");
  const listC = widgetList("list-c", "List C");
  const futureSeconds = new Date(Date.now() + 30_000).toISOString();
  const futureMinutes = new Date(Date.now() + 90_000).toISOString();
  const futureHours = new Date(Date.now() + 125 * 60_000).toISOString();
  const pastMinutes = new Date(Date.now() - 90_000).toISOString();
  const rich = dashboardFromLists(agentId, [
    {
      list: listA,
      tasks: [
        widgetTask({ id: "mine-run", list_id: listA.id, title: "Mine run", status: "in_progress", claimed_by_agent_id: agentId, claim_expires_at: futureSeconds }),
        widgetTask({ id: "mine-blocked", list_id: listA.id, position: 2, title: "Mine blocked", status: "blocked", assigned_to_agent_id: agentId }),
        widgetTask({ id: "mine-todo", list_id: listA.id, position: 3, title: "Mine todo", status: "todo", assigned_to_agent_id: agentId }),
        widgetTask({ id: "mine-canceled", list_id: listA.id, position: 4, title: "Mine canceled", status: "canceled", assigned_to_agent_id: agentId }),
        widgetTask({ id: "mine-done", list_id: listA.id, position: 5, title: "Mine done", status: "done", assigned_to_agent_id: agentId }),
      ],
    },
    { list: listB, tasks: [widgetTask({ id: "other-run", list_id: listB.id, title: "Other run", status: "in_progress", claim_expires_at: futureHours })] },
    { list: listC, tasks: [widgetTask({ id: "other-done", list_id: listC.id, title: "Other done", status: "done" })] },
    { list: widgetList("empty", "Empty"), tasks: [] },
  ]);
  const compact = formatDashboard(rich, "compact");
  assert.equal(compact.some((line) => line.includes("very-long-agent…")), true);
  assert.equal(compact.some((line) => line.includes("autre(s) tâche(s) à moi")), true);
  assert.equal(compact.some((line) => line.includes("done 1")), true);
  assert.equal(compact.some((line) => line.includes("canceled 1")), true);
  assert.equal(compact.some((line) => line.includes("liste(s) masquée(s)")), true);
  const full = formatDashboard(rich, "full");
  assert.equal(full.some((line) => line.includes("claim 30s")), true);
  const hourClaim = dashboardFromLists("claim-agent", [
    { list: widgetList("claims", "Claims"), tasks: [widgetTask({ id: "hour-claim", list_id: "claims", title: "Hour claim", status: "in_progress", claim_expires_at: futureHours })] },
  ]);
  assert.equal(formatDashboard(hourClaim, "full").some((line) => line.includes("claim 2h")), true);

  const originalDateNow = Date.now;
  Date.now = () => Date.parse("2026-01-01T00:00:00.000Z");
  try {
    const exactHourClaim = dashboardFromLists("claim-agent", [
      {
        list: widgetList("exact-claim", "Exact Claim"),
        tasks: [widgetTask({ id: "exact-hour-claim", list_id: "exact-claim", title: "Exact hour claim", status: "in_progress", claim_expires_at: "2026-01-01T02:00:00.000Z" })],
      },
    ]);
    assert.equal(formatDashboard(exactHourClaim, "full").some((line) => line.includes("Exact hour claim") && line.includes("claim 2h")), true);
  } finally {
    Date.now = originalDateNow;
  }

  const durations = dashboardFromLists("duration-agent", [
    {
      list: widgetList("durations", "Durations"),
      tasks: [
        widgetTask({ id: "done-seconds", list_id: "durations", title: "Done seconds", status: "done", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:00:45.000Z" }),
        widgetTask({ id: "done-minute", list_id: "durations", position: 2, title: "Done minute", status: "done", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:01:05.000Z" }),
        widgetTask({ id: "canceled-hours", list_id: "durations", position: 3, title: "Canceled hours", status: "canceled", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T02:05:00.000Z" }),
      ],
    },
  ]);
  const durationLines = formatDashboard(durations, "full");
  assert.equal(durationLines.some((line) => line.includes("duration 45s")), true);
  assert.equal(durationLines.some((line) => line.includes("duration 1m5s")), true);
  assert.equal(durationLines.some((line) => line.includes("duration 2h5m")), true);

  const invalidDurations = dashboardFromLists("duration-agent", [
    {
      list: widgetList("invalid", "Invalid"),
      tasks: [
        widgetTask({ id: "bad-duration", list_id: "invalid", title: "Bad duration", status: "done", started_at: "not-a-date", completed_at: "2026-01-01T00:00:00.000Z" }),
        widgetTask({ id: "hour-duration", list_id: "invalid", position: 2, title: "Hour duration", status: "done", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T02:00:00.000Z" }),
        widgetTask({ id: "bad-claim", list_id: "invalid", position: 3, title: "Bad claim", status: "in_progress", claim_expires_at: "not-a-date" }),
      ],
    },
  ]);
  const invalidLines = formatDashboard(invalidDurations, "full");
  assert.equal(invalidLines.some((line) => line.includes("duration ?")), true);
  assert.equal(invalidLines.some((line) => line.includes("duration 2h")), true);
  assert.equal(invalidLines.some((line) => line.includes("claim not-a-date")), true);

  const claimTimes = dashboardFromLists("claim-agent", [
    {
      list: widgetList("claim-times", "Claim Times"),
      tasks: [
        widgetTask({ id: "minute-claim", list_id: "claim-times", title: "Minute claim", status: "in_progress", claim_expires_at: futureMinutes }),
        widgetTask({ id: "past-claim", list_id: "claim-times", position: 2, title: "Past claim", status: "in_progress", claim_expires_at: pastMinutes }),
      ],
    },
  ]);
  const claimLines = formatDashboard(claimTimes, "full");
  assert.equal(claimLines.some((line) => line.includes("claim 1m")), true);
  assert.equal(claimLines.some((line) => line.includes("claim -1m")), true);

  const exactMinuteDuration = dashboardFromLists("duration-agent", [
    {
      list: widgetList("minute", "Minute"),
      tasks: [widgetTask({ id: "one-minute", list_id: "minute", title: "One minute", status: "done", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:01:00.000Z" })],
    },
  ]);
  assert.equal(formatDashboard(exactMinuteDuration, "full").some((line) => line.includes("duration 1m")), true);

  const tieBreaksAndTruncation = dashboardFromLists("agent", [
    {
      list: widgetList("beta", "Beta"),
      tasks: [widgetTask({ id: "beta", list_id: "beta", title: "B".repeat(140), status: "todo", assigned_to_agent_id: "agent", created_at: "2026-01-01T00:00:00.000Z" })],
    },
    {
      list: widgetList("alpha", "Alpha"),
      tasks: [widgetTask({ id: "alpha", list_id: "alpha", title: "Alpha task", status: "todo", assigned_to_agent_id: "agent", created_at: "2026-01-01T00:00:00.000Z" })],
    },
  ]);
  const tieLines = formatDashboard(tieBreaksAndTruncation, "full");
  assert.equal(tieLines.some((line) => line.includes("Alpha task")), true);
  assert.equal(tieLines.some((line) => line.includes("…")), true);

  const omittedWhileSpaceRemains = dashboardFromLists("agent", [
    {
      list: widgetList("first", "First"),
      tasks: Array.from({ length: 6 }, (_, index) => widgetTask({ id: `first-${index}`, list_id: "first", position: index + 1, title: `First ${index}` })),
    },
    { list: widgetList("second", "Second"), tasks: [widgetTask({ id: "second-task", list_id: "second", title: "Second task" })] },
  ]);
  assert.equal(formatDashboard(omittedWhileSpaceRemains, "full").some((line) => line.includes("tâche(s) dans First")), true);

  const hiddenTasks = dashboardFromLists("agent", [
    {
      list: widgetList("hidden", "Hidden Tasks"),
      tasks: Array.from({ length: 6 }, (_, index) => widgetTask({ id: `todo-${index}`, list_id: "hidden", position: index + 1, title: `Todo ${index}` })),
    },
  ]);
  assert.equal(formatDashboard(hiddenTasks, "full").some((line) => line.includes("tâche(s) masquée(s) dans Hidden Tasks")), true);

  const hiddenLists = dashboardFromLists(
    "agent",
    Array.from({ length: 12 }, (_, index) => ({
      list: widgetList(`list-${index}`, `List ${index}`),
      tasks: [widgetTask({ id: `task-${index}`, list_id: `list-${index}`, title: `Task ${index}` })],
    })),
  );
  assert.equal(formatDashboard(hiddenLists, "full").some((line) => line.includes("masquée(s) · /tasks <list_id>")), true);
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
