import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolvePiAgentId } from "../core/agent-id.js";
import { buildDashboard, type DashboardData, type DashboardList, type DashboardTask } from "../core/dashboard.js";
import { TaskService } from "../core/service.js";
import type { AccessOptions, TaskStatus } from "../core/types.js";

const WIDGET_KEY = "pi-tasks";
const REFRESH_INTERVAL_MS = 10_000;
const MAX_COMPACT_LISTS = 5;
const MAX_COMPACT_MY_TASKS = 6;
const MAX_FULL_LISTS = 8;
const MAX_FULL_TASKS_PER_LIST = 8;
const MAX_LINE_CHARS = 110;

type WidgetMode = "compact" | "full";

interface WidgetState {
  enabled: boolean;
  mode: WidgetMode;
  timer?: ReturnType<typeof setInterval>;
  warnedAboutAgentId: boolean;
}

const state: WidgetState = {
  enabled: true,
  mode: "compact",
  warnedAboutAgentId: false,
};

export function registerPiTasksDashboardWidget(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    startPolling(ctx);
    refreshWidget(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    refreshWidget(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!ctx.hasUI || !event.toolName.startsWith("task_")) return;
    refreshWidget(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopPolling();
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    ctx.ui.setStatus(WIDGET_KEY, undefined);
  });

  pi.registerCommand("task-widget", {
    description: "Control the pi-tasks dashboard widget: /task-widget on|off|compact|full|refresh",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "refresh";

      switch (action) {
        case "on":
          state.enabled = true;
          startPolling(ctx);
          refreshWidget(ctx, { notify: true });
          break;
        case "off":
          state.enabled = false;
          stopPolling();
          ctx.ui.setWidget(WIDGET_KEY, undefined);
          ctx.ui.setStatus(WIDGET_KEY, undefined);
          ctx.ui.notify("pi-tasks widget disabled for this session", "info");
          break;
        case "compact":
          state.enabled = true;
          state.mode = "compact";
          startPolling(ctx);
          refreshWidget(ctx, { notify: true });
          break;
        case "full":
          state.enabled = true;
          state.mode = "full";
          startPolling(ctx);
          refreshWidget(ctx, { notify: true });
          break;
        case "refresh":
          refreshWidget(ctx, { notify: true });
          break;
        default:
          ctx.ui.notify("Usage: /task-widget on|off|compact|full|refresh", "error");
      }
    },
  });
}

function startPolling(ctx: ExtensionContext): void {
  if (!state.enabled) return;
  stopPolling();
  state.timer = setInterval(() => refreshWidget(ctx), REFRESH_INTERVAL_MS);
  state.timer.unref?.();
}

function stopPolling(): void {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = undefined;
}

function refreshWidget(ctx: ExtensionContext, options: { notify?: boolean } = {}): void {
  if (!state.enabled) return;

  try {
    const { service, access, warning } = openForWidget(ctx);
    try {
      if (warning && !state.warnedAboutAgentId) {
        state.warnedAboutAgentId = true;
        ctx.ui.notify(warning, "warning");
      }

      const dashboard = buildDashboard(service, access);
      if (dashboard.lists.length === 0) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        ctx.ui.setStatus(WIDGET_KEY, undefined);
        if (options.notify) ctx.ui.notify("pi-tasks widget: no visible task lists", "info");
        return;
      }

      ctx.ui.setWidget(WIDGET_KEY, formatDashboard(dashboard, state.mode), { placement: "aboveEditor" });
      ctx.ui.setStatus(WIDGET_KEY, formatStatus(dashboard));
      if (options.notify) ctx.ui.notify(`pi-tasks widget refreshed (${state.mode})`, "info");
    } finally {
      service.close();
    }
  } catch (error) {
    ctx.ui.setStatus(WIDGET_KEY, "pi-tasks: error");
    if (options.notify) {
      ctx.ui.notify(`pi-tasks widget refresh failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
}

function openForWidget(ctx: ExtensionContext): { service: TaskService; access: AccessOptions; warning?: string } {
  const resolved = resolvePiAgentId(ctx.sessionManager);
  const service = new TaskService({ cwd: ctx.cwd });
  return {
    service,
    access: { actor: { agentId: resolved.agentId, source: "pi" } },
    warning: resolved.warning,
  };
}

function formatDashboard(dashboard: DashboardData, mode: WidgetMode): string[] {
  const lines: string[] = [];
  const agent = shortenAgentId(dashboard.agentId);
  const activeLists = dashboard.lists.filter((list) => list.totalActiveTasks > 0);
  const listCount = dashboard.lists.length;
  const visibleTaskCount = dashboard.totalActiveTasks;

  lines.push(
    limitLine(
      `pi-tasks · agent ${agent} · ${plural(listCount, "list")} · ${plural(visibleTaskCount, "task")} · ` +
        `mine: ${statusGlyph("in_progress")}${dashboard.myCounts.in_progress} ${statusGlyph("todo")}${dashboard.myCounts.todo} ${statusGlyph("blocked")}${dashboard.myCounts.blocked}`,
    ),
  );

  if (activeLists.length === 0) {
    lines.push("  no active tasks in visible lists");
    return lines;
  }

  const listsToShow = activeLists.slice(0, mode === "full" ? MAX_FULL_LISTS : MAX_COMPACT_LISTS);
  for (const item of listsToShow) {
    lines.push(formatListLine(item));
    if (mode === "full") {
      for (const task of item.tasks.slice(0, MAX_FULL_TASKS_PER_LIST)) {
        lines.push(formatTaskLine({ task, list: item.list, assignedToAgent: false, claimedByAgent: false }, "    "));
      }
      if (item.tasks.length > MAX_FULL_TASKS_PER_LIST) {
        lines.push(limitLine(`    … ${item.tasks.length - MAX_FULL_TASKS_PER_LIST} more task(s)`));
      }
    }
  }

  if (activeLists.length > listsToShow.length) {
    lines.push(limitLine(`  … ${activeLists.length - listsToShow.length} more active list(s)`));
  }

  if (dashboard.myTasks.length > 0) {
    lines.push("  my tasks:");
    const myTasks = dashboard.myTasks.slice(0, MAX_COMPACT_MY_TASKS);
    for (const task of myTasks) lines.push(formatTaskLine(task, "    "));
    if (dashboard.myTasks.length > myTasks.length) {
      lines.push(limitLine(`    … ${dashboard.myTasks.length - myTasks.length} more assigned/claimed task(s)`));
    }
  } else if (mode === "compact") {
    lines.push("  my tasks: none assigned or claimed");
  }

  return lines;
}

function formatStatus(dashboard: DashboardData): string {
  return `tasks ${statusGlyph("in_progress")}${dashboard.myCounts.in_progress}/${dashboard.counts.in_progress} ${statusGlyph("todo")}${dashboard.counts.todo} ${statusGlyph("blocked")}${dashboard.counts.blocked}`;
}

function formatListLine(item: DashboardList): string {
  const c = item.counts;
  return limitLine(
    `  ${statusGlyph("todo")} ${item.list.name} · ` +
      `${statusGlyph("todo")}${c.todo} ${statusGlyph("in_progress")}${c.in_progress} ${statusGlyph("blocked")}${c.blocked} ${statusGlyph("done")}${c.done} ${statusGlyph("canceled")}${c.canceled}`,
  );
}

function formatTaskLine(item: DashboardTask, indent: string): string {
  const task = item.task;
  const markers: string[] = [];
  if (item.claimedByAgent) markers.push("claimed");
  if (item.assignedToAgent) markers.push("assigned");
  if (task.status === "in_progress" && task.claim_expires_at) markers.push(`expires ${relativeTime(task.claim_expires_at)}`);
  if ((task.status === "done" || task.status === "canceled") && task.started_at && task.completed_at) {
    markers.push(`duration ${durationBetween(task.started_at, task.completed_at)}`);
  }

  const suffix = markers.length > 0 ? ` · ${markers.join(", ")}` : "";
  const listPrefix = item.list.name ? ` · ${item.list.name}` : "";
  return limitLine(`${indent}${statusGlyph(task.status)} ${task.title}${suffix}${listPrefix}`);
}

function statusGlyph(status: TaskStatus): string {
  switch (status) {
    case "todo":
      return "○";
    case "in_progress":
      return "▶";
    case "blocked":
      return "■";
    case "done":
      return "✓";
    case "canceled":
      return "×";
  }
}

function shortenAgentId(agentId: string): string {
  if (agentId.startsWith("pi-session:")) return `pi:${agentId.slice("pi-session:".length, "pi-session:".length + 8)}`;
  if (agentId.length <= 18) return agentId;
  return `${agentId.slice(0, 15)}…`;
}

function relativeTime(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return iso;
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 1) return `${sign}${Math.max(0, Math.round(abs / 1000))}s`;
  if (minutes < 60) return `${sign}${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${sign}${hours}h` : `${sign}${hours}h${rest}m`;
}

function durationBetween(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds === 0 ? `${minutes}m` : `${minutes}m${restSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h${restMinutes}m`;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function limitLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1)}…` : line;
}
