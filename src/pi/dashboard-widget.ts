import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { resolvePiAgentId } from "../core/agent-id.js";
import { buildDashboard, type DashboardData, type DashboardList, type DashboardTask, type StatusCounts } from "../core/dashboard.js";
import { TaskService } from "../core/service.js";
import type { AccessOptions, Task, TaskList, TaskStatus } from "../core/types.js";

const WIDGET_KEY = "pi-tasks";
const REFRESH_INTERVAL_MS = 10_000;
const PI_MAX_WIDGET_LINES = 10;
const COMPACT_WIDGET_LINES = 8;
const FULL_WIDGET_LINES = PI_MAX_WIDGET_LINES;
const MAX_INNER_CHARS = 106;
const MIN_INNER_CHARS = 38;

const TASK_WIDGET_ACTIONS: AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable the pi-tasks widget" },
  { value: "off", label: "off", description: "Disable the pi-tasks widget for this session" },
  { value: "compact", label: "compact", description: "Show the compact widget layout" },
  { value: "full", label: "full", description: "Show the full widget layout" },
  { value: "refresh", label: "refresh", description: "Refresh the widget immediately" },
];

type WidgetMode = "compact" | "full";

type FrameEntry =
  | { kind: "line"; text: string }
  | { kind: "separator"; text: string };

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
    getArgumentCompletions: getTaskWidgetArgumentCompletions,
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

export function getTaskWidgetArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const query = prefix.trimStart().toLowerCase();
  if (/\s/.test(query)) return null;
  const matches = TASK_WIDGET_ACTIONS.filter((item) => item.value.startsWith(query));
  return matches.length > 0 ? matches : null;
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

      const dashboard = buildDashboard(service, access, { includeDone: true });
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

export function formatDashboard(dashboard: DashboardData, mode: WidgetMode): string[] {
  const title = `pi-tasks · ${shortenAgentId(dashboard.agentId)} · ${plural(dashboard.lists.length, "list")} · ${plural(dashboard.totalActiveTasks, "task")}`;
  const maxLines = mode === "full" ? FULL_WIDGET_LINES : COMPACT_WIDGET_LINES;
  const entries = mode === "full" ? buildFullEntries(dashboard) : buildCompactEntries(dashboard);
  const footer = mode === "full" ? "/task-widget compact · /tasks <list_id>" : "/task-widget full · /tasks <list_id>";

  return frameEntries(title, entries, footer, maxLines);
}

function buildCompactEntries(dashboard: DashboardData): FrameEntry[] {
  const budget = COMPACT_WIDGET_LINES - 2;
  const entries: FrameEntry[] = [];
  const myTasks = prioritizedMyTasks(dashboard);

  entries.push(line(`moi · ${formatMineCounts(dashboard.myCounts)}`));

  const maxMyTasks = Math.min(myTasks.length, 2);
  for (const item of myTasks.slice(0, maxMyTasks)) {
    entries.push(line(formatTaskLine(item.task, item.list, { agentId: dashboard.agentId, includeListName: true, mySection: true, indent: "  " })));
  }
  const hiddenMyTasks = myTasks.length - maxMyTasks;
  if (hiddenMyTasks > 0 && entries.length < budget - 2) {
    entries.push(line(`  … ${hiddenMyTasks} autre(s) tâche(s) à moi`));
  }

  if (entries.length < budget) entries.push(separator("listes"));

  const lists = prioritizedLists(dashboard);
  if (lists.length === 0) {
    if (entries.length < budget) entries.push(line("aucune tâche visible"));
    return entries;
  }

  const listSlots = budget - entries.length;
  const listLimit = lists.length > listSlots ? Math.max(0, listSlots - 1) : listSlots;
  for (const item of lists.slice(0, listLimit)) {
    entries.push(line(formatListSummary(item)));
  }

  const hiddenLists = lists.length - listLimit;
  if (hiddenLists > 0 && entries.length < budget) {
    entries.push(line(`… ${hiddenLists} liste(s) masquée(s) · /task-lists`));
  }

  return entries;
}

function buildFullEntries(dashboard: DashboardData): FrameEntry[] {
  const budget = FULL_WIDGET_LINES - 2;
  const entries: FrameEntry[] = [];
  const myTasks = prioritizedMyTasks(dashboard);

  entries.push(line(`moi · ${formatMineCounts(dashboard.myCounts)}`));

  const maxMyTasks = Math.min(myTasks.length, 2);
  for (const item of myTasks.slice(0, maxMyTasks)) {
    entries.push(line(formatTaskLine(item.task, item.list, { agentId: dashboard.agentId, includeListName: true, mySection: true, indent: "  " })));
  }
  const hiddenMyTasks = myTasks.length - maxMyTasks;
  if (hiddenMyTasks > 0 && entries.length < budget - 2) {
    entries.push(line(`  … ${hiddenMyTasks} autre(s) tâche(s) à moi`));
  }

  const lists = prioritizedLists(dashboard);
  if (lists.length === 0) {
    if (entries.length < budget) entries.push(line("aucune tâche visible"));
    return entries;
  }

  let hiddenListCount = 0;
  const hiddenTaskNotes: string[] = [];

  for (let i = 0; i < lists.length; i += 1) {
    if (entries.length >= budget) {
      hiddenListCount = lists.length - i;
      break;
    }

    const item = lists[i]!;
    entries.push(separator(formatListSummary(item)));

    const remainingAfterHeader = budget - entries.length;
    if (remainingAfterHeader <= 0) {
      hiddenListCount = lists.length - i - 1;
      break;
    }

    const remainingListsAfter = lists.length - i - 1;
    const reserveForLaterLists = remainingListsAfter > 0 ? 1 : 0;
    const taskSlots = Math.min(3, Math.max(0, remainingAfterHeader - reserveForLaterLists));
    const tasks = prioritizedTasksForList(item, dashboard.agentId);
    const tasksToShow = tasks.slice(0, taskSlots);

    for (const task of tasksToShow) {
      entries.push(line(formatTaskLine(task, item.list, { agentId: dashboard.agentId, includeListName: false, mySection: false, indent: "  " })));
    }

    const hiddenTasks = tasks.length - tasksToShow.length;
    if (hiddenTasks > 0) {
      if (remainingListsAfter === 0 && entries.length < budget) entries.push(line(`  … ${hiddenTasks} tâche(s) masquée(s) dans ${item.list.name}`));
      else hiddenTaskNotes.push(`${hiddenTasks} tâche(s) dans ${item.list.name}`);
    }
  }

  if (hiddenListCount > 0 || hiddenTaskNotes.length > 0) {
    const parts = [...hiddenTaskNotes];
    if (hiddenListCount > 0) parts.push(`${hiddenListCount} liste(s)`);
    addOmissionLine(entries, budget, `… ${parts.join(" · ")} masquée(s) · /tasks <list_id>`);
  }

  return entries;
}

function prioritizedMyTasks(dashboard: DashboardData): DashboardTask[] {
  return [...dashboard.myTasks].sort((a, b) => compareTasksForDisplay(a.task, b.task) || a.list.name.localeCompare(b.list.name));
}

function prioritizedLists(dashboard: DashboardData): DashboardList[] {
  return dashboard.lists
    .filter((item) => item.totalActiveTasks > 0)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => listScore(b.item) - listScore(a.item) || a.index - b.index)
    .map(({ item }) => item);
}

function prioritizedTasksForList(item: DashboardList, agentId: string): Task[] {
  return [...item.tasks].sort((a, b) => compareTaskOwnership(b, a, agentId) || compareTasksForDisplay(a, b));
}

function listScore(item: DashboardList): number {
  const c = item.counts;
  return item.myTasks.length * 10_000 + c.in_progress * 1_000 + c.blocked * 500 + c.todo * 100 + c.done * 10 + c.canceled * 5 + item.totalActiveTasks;
}

function compareTaskOwnership(a: Task, b: Task, agentId: string): number {
  return Number(isMine(a, agentId)) - Number(isMine(b, agentId));
}

function compareTasksForDisplay(a: Task, b: Task): number {
  return statusPriority(a.status) - statusPriority(b.status) || a.position - b.position || a.created_at.localeCompare(b.created_at);
}

function statusPriority(status: TaskStatus): number {
  switch (status) {
    case "in_progress":
      return 0;
    case "blocked":
      return 1;
    case "todo":
      return 2;
    case "done":
      return 3;
    case "canceled":
      return 4;
  }
}

function isMine(task: Task, agentId: string): boolean {
  return task.claimed_by_agent_id === agentId || task.assigned_to_agent_id === agentId;
}

function line(text: string): FrameEntry {
  return { kind: "line", text };
}

function separator(text: string): FrameEntry {
  return { kind: "separator", text };
}

function addOmissionLine(entries: FrameEntry[], budget: number, text: string): void {
  if (entries.length < budget) {
    entries.push(line(text));
    return;
  }
  if (budget > 0) entries[budget - 1] = line(text);
}

function frameEntries(title: string, entries: FrameEntry[], footer: string, maxLines: number): string[] {
  const bodyBudget = Math.max(1, maxLines - 2);
  const safeEntries = entries.length <= bodyBudget
    ? entries
    : [...entries.slice(0, bodyBudget - 1), line(`… ${entries.length - bodyBudget + 1} ligne(s) masquée(s) · /tasks <list_id>`)];

  const normalizedTitle = truncateLine(title, MAX_INNER_CHARS);
  const normalizedFooter = truncateLine(footer, MAX_INNER_CHARS);
  const normalizedEntries = safeEntries.map((entry) => ({ ...entry, text: truncateLine(entry.text, MAX_INNER_CHARS) }));
  const width = Math.max(
    MIN_INNER_CHARS,
    normalizedTitle.length,
    normalizedFooter.length,
    ...normalizedEntries.map((entry) => entry.text.length),
  );

  return [
    borderLine("╭", "╮", width, normalizedTitle),
    ...normalizedEntries.map((entry) => (entry.kind === "separator" ? borderLine("├", "┤", width, entry.text, "─ ") : bodyLine(entry.text, width))),
    borderLine("╰", "╯", width, normalizedFooter),
  ];
}

function borderLine(left: string, right: string, width: number, label?: string, prefix = " "): string {
  const span = width + 2;
  const labelText = label ? `${prefix}${label} ` : "";
  return `${left}${labelText}${"─".repeat(Math.max(0, span - labelText.length))}${right}`;
}

function bodyLine(text: string, width: number): string {
  return `│ ${text.padEnd(width, " ")} │`;
}

function formatStatus(dashboard: DashboardData): string {
  return `tasks run ${dashboard.myCounts.in_progress}/${dashboard.counts.in_progress} todo ${dashboard.counts.todo} blocked ${dashboard.counts.blocked}`;
}

function formatMineCounts(counts: StatusCounts): string {
  const parts = [`run ${counts.in_progress}`, `todo ${counts.todo}`, `paused ${counts.blocked}`];
  if (counts.done > 0) parts.push(`done ${counts.done}`);
  if (counts.canceled > 0) parts.push(`canceled ${counts.canceled}`);
  return parts.join(" · ");
}

function formatListSummary(item: DashboardList): string {
  return `${item.list.name} · ${formatCounts(item.counts)}`;
}

function formatCounts(counts: StatusCounts): string {
  const parts = [`todo ${counts.todo}`, `run ${counts.in_progress}`, `blocked ${counts.blocked}`, `done ${counts.done}`];
  if (counts.canceled > 0) parts.push(`canceled ${counts.canceled}`);
  return parts.join(" · ");
}

function formatTaskLine(
  task: Task,
  list: TaskList,
  options: { agentId: string; includeListName: boolean; mySection: boolean; indent: string },
): string {
  const markers: string[] = [];
  const mine = isMine(task, options.agentId);

  if (!options.mySection && mine) markers.push("mine");
  if (task.status === "blocked") markers.push("paused");
  if (task.status === "in_progress" && task.claim_expires_at) markers.push(`claim ${relativeTime(task.claim_expires_at)}`);
  if ((task.status === "done" || task.status === "canceled") && task.started_at && task.completed_at) {
    markers.push(`duration ${durationBetween(task.started_at, task.completed_at)}`);
  }
  if (options.includeListName) markers.push(list.name);

  const suffix = markers.length > 0 ? ` · ${markers.join(" · ")}` : "";
  return `${options.indent}${statusGlyph(task.status)} ${task.title}${suffix}`;
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

function truncateLine(line: string, maxChars: number): string {
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}
