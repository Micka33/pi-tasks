import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { resolvePiAgentId } from "../core/agent-id.js";
import { PrivateListAccessError } from "../core/errors.js";
import { TaskService } from "../core/service.js";
import type { AccessOptions, DeleteTaskListResult, PrivateAccessEvent, Task, TaskList, TaskListWithTasks, TaskStatus } from "../core/types.js";
import { currentPiTasksLocale, normalizePiTasksLocale, piTasksMessages, setPiTasksLocaleOverride, SUPPORTED_PI_TASKS_LOCALES, type PiTasksLocale } from "../i18n/index.js";

export function registerPiTaskCommands(pi: ExtensionAPI): void {
  const ui = piTasksMessages().commands;
  pi.registerCommand("task-store", {
    description: ui.descriptions.taskStore,
    handler: async (_args, ctx) => {
      const { service, access, warning } = openForCommand(ctx);
      try {
        if (warning) ctx.ui.notify(warning, "warning");
        ctx.ui.notify(JSON.stringify(service.getAgentSummary(access.actor), null, 2), "info");
      } finally {
        service.close();
      }
    },
  });

  pi.registerCommand("task-agent", {
    description: ui.descriptions.taskAgent,
    handler: async (_args, ctx) => {
      const resolved = resolvePiAgentId(ctx.sessionManager);
      if (resolved.warning) ctx.ui.notify(resolved.warning, "warning");
      ctx.ui.notify(resolved.agentId, "info");
    },
  });

  pi.registerCommand("task-language", {
    description: formatSupportedLocaleTemplate(ui.descriptions.taskLanguage, "|"),
    getArgumentCompletions: getTaskLanguageArgumentCompletions,
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!input) {
        ctx.ui.notify(formatTaskLanguageCommandOutput(), "info");
        return;
      }

      const locale = normalizePiTasksLocale(input);
      if (!locale) {
        ctx.ui.notify(formatUnsupportedTaskLanguageOutput(input), "error");
        return;
      }

      setPiTasksLocaleOverride(locale);
      ctx.ui.notify(formatTaskLanguageChangedOutput(locale), "info");
    },
  });

  pi.registerCommand("task-lists", {
    description: ui.descriptions.taskLists,
    handler: async (args, ctx) => {
      const ui = piTasksMessages().commands;
      const arg = args.trim().toLowerCase();
      const full = arg === "full" || arg === "--full" || arg === "-f";
      if (arg && !full) {
        ctx.ui.notify(ui.usage.taskLists, "error");
        return;
      }

      const { service, access, warning } = openForCommand(ctx);
      try {
        if (warning) ctx.ui.notify(warning, "warning");
        const lists = service.findTaskLists({}, access);
        ctx.ui.notify(formatTaskListsCommandOutput(lists, { full }), "info");
      } finally {
        service.close();
      }
    },
  });

  pi.registerCommand("tasks", {
    description: ui.descriptions.tasks,
    handler: async (args, ctx) => {
      const ui = piTasksMessages().commands;
      const parsed = parseTasksArgs(args);
      if (!parsed) {
        ctx.ui.notify(ui.usage.tasks, "error");
        return;
      }

      const output = await withOptionalBypass(ctx, "tasks", (service, access) => {
        const data = service.getTaskList({ list_id: parsed.listId }, access);
        return parsed.full ? JSON.stringify(data, null, 2) : formatTasksCommandOutput(data, access.actor.agentId);
      });
      ctx.ui.notify(output, "info");
    },
  });

  pi.registerCommand("task-list-delete", {
    description: ui.descriptions.taskListDelete,
    handler: async (args, ctx) => {
      const ui = piTasksMessages().commands;
      const listId = args.trim();
      if (!listId || /\s/.test(listId)) {
        ctx.ui.notify(ui.usage.taskListDelete, "error");
        return;
      }

      const output = await withOptionalBypass(ctx, "task-list-delete", (service, access) => {
        return formatTaskListDeleteCommandOutput(service.deleteTaskList({ list_id: listId }, access));
      });
      ctx.ui.notify(output, "info");
    },
  });

  pi.registerCommand("task-audit", {
    description: ui.descriptions.taskAudit,
    handler: async (args, ctx) => {
      const ui = piTasksMessages().commands;
      const parsed = parseTaskAuditArgs(args);
      if (!parsed) {
        ctx.ui.notify(ui.usage.taskAudit, "error");
        return;
      }

      const output = await withOptionalBypass(ctx, "task-audit", (service, access) => {
        const events = service.getPrivateAccessEvents(parsed.listId ? { list_id: parsed.listId } : {}, access);
        return parsed.full ? JSON.stringify(events, null, 2) : formatTaskAuditCommandOutput(events);
      });
      ctx.ui.notify(output, "info");
    },
  });
}

export function getTaskLanguageArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const query = prefix.trimStart().toLowerCase();
  if (/\s/.test(query)) return null;
  const names = piTasksMessages().commands.language.names;
  const matches = SUPPORTED_PI_TASKS_LOCALES.filter((locale) => locale.startsWith(query)).map((locale) => ({
    value: locale,
    label: locale,
    description: names[locale],
  }));
  return matches.length > 0 ? matches : null;
}

export function formatTaskLanguageCommandOutput(): string {
  const ui = piTasksMessages().commands;
  return [
    ui.language.current.replaceAll("{locale}", currentPiTasksLocale()),
    ui.language.available.replaceAll("{locales}", SUPPORTED_PI_TASKS_LOCALES.join(", ")),
    formatTaskLanguageUsage(ui.usage.taskLanguage),
  ].join("\n");
}

export function formatTaskLanguageChangedOutput(locale: PiTasksLocale): string {
  const ui = piTasksMessages().commands.language;
  return [ui.changed.replaceAll("{locale}", locale), ui.refreshHint].join("\n");
}

export function formatUnsupportedTaskLanguageOutput(input: string): string {
  const ui = piTasksMessages().commands;
  return [
    ui.language.unsupported.replaceAll("{locale}", input),
    ui.language.available.replaceAll("{locales}", SUPPORTED_PI_TASKS_LOCALES.join(", ")),
    formatTaskLanguageUsage(ui.usage.taskLanguage),
  ].join("\n");
}

function formatTaskLanguageUsage(template: string): string {
  return formatSupportedLocaleTemplate(template, "|");
}

function formatSupportedLocaleTemplate(template: string, separator: string): string {
  return template.replaceAll("{locales}", SUPPORTED_PI_TASKS_LOCALES.join(separator));
}

export function formatTaskListsCommandOutput(lists: TaskList[], options: { full?: boolean } = {}): string {
  if (options.full) return JSON.stringify(lists, null, 2);
  const ui = piTasksMessages().commands.taskLists;
  if (lists.length === 0) return ui.none;
  return lists.map((list) => `- ${ui.name}: ${list.name}\n  ${ui.id}: ${list.id}`).join("\n");
}

export function formatTaskListDeleteCommandOutput(result: DeleteTaskListResult): string {
  const ui = piTasksMessages().commands.delete;
  const lines = [
    ui.heading,
    `- ${ui.name}: ${result.list.name}`,
    `  ${ui.id}: ${result.list.id}`,
    `  ${ui.deletedAt}: ${result.list.deleted_at ?? ui.alreadyDeleted}`,
    `  ${ui.activeTasksDeleted}: ${result.deleted_tasks.length}`,
  ];
  return lines.join("\n");
}

export function formatTaskAuditCommandOutput(events: PrivateAccessEvent[]): string {
  const ui = piTasksMessages().commands.audit;
  if (events.length === 0) return `${ui.heading}\n${ui.none}`;

  const lines = [ui.heading];
  for (const event of events) {
    lines.push("");
    lines.push(`${formatIso(event.created_at)} · list=${event.list_id} · actor=${event.actor_agent_id} · tool=${event.tool_name}`);
    lines.push(`  ${ui.reason}: ${event.reason}`);
  }
  return lines.join("\n");
}

export function formatTasksCommandOutput(data: TaskListWithTasks, actorAgentId: string): string {
  const { list, tasks } = data;
  const ui = piTasksMessages().commands.tasks;
  const lines: string[] = [];
  lines.push(list.name);
  lines.push(`id: ${list.id} · ${list.scope_type} · ${list.visibility}`);
  lines.push(`${ui.counts}: ${formatCounts(countTasks(tasks))}`);

  if (tasks.length === 0) {
    lines.push("");
    lines.push(ui.empty);
    return lines.join("\n");
  }

  for (const task of tasks) {
    lines.push("");
    lines.push(`#${task.position} ${statusGlyph(task.status)} ${statusLabel(task.status)} · ${task.title} (${task.id})`);
    lines.push(`   ${formatAgentLine(task, actorAgentId)}`);
    lines.push(`   ${formatTimeLine(task)}`);
    appendTextBlock(lines, ui.labels.description, task.description);
    appendTextBlock(lines, ui.labels.notes, task.notes);
    appendTextBlock(lines, ui.labels.outcome, task.outcome);
  }

  return lines.join("\n");
}

function parseTasksArgs(args: string): { listId: string; full: boolean } | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { listId: parts[0]!, full: false };
  if (parts.length === 2 && isFullArg(parts[1]!)) return { listId: parts[0]!, full: true };
  return null;
}

function parseTaskAuditArgs(args: string): { listId?: string; full: boolean } | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { full: false };
  if (parts.length === 1) return isFullArg(parts[0]!) ? { full: true } : { listId: parts[0]!, full: false };
  if (parts.length === 2 && isFullArg(parts[1]!)) return { listId: parts[0]!, full: true };
  return null;
}

function isFullArg(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "full" || normalized === "json" || normalized === "--full" || normalized === "-f";
}

function countTasks(tasks: Task[]): Record<TaskStatus, number> {
  return tasks.reduce(
    (counts, task) => {
      counts[task.status] += 1;
      return counts;
    },
    { todo: 0, in_progress: 0, blocked: 0, done: 0, canceled: 0 } satisfies Record<TaskStatus, number>,
  );
}

function formatCounts(counts: Record<TaskStatus, number>): string {
  const labels = piTasksMessages().commands.tasks.countsLabels;
  return [
    `${labels.todo} ${counts.todo}`,
    `${labels.run} ${counts.in_progress}`,
    `${labels.blocked} ${counts.blocked}`,
    `${labels.done} ${counts.done}`,
    `${labels.canceled} ${counts.canceled}`,
  ].join(" · ");
}

function formatAgentLine(task: Task, actorAgentId: string): string {
  const ui = piTasksMessages().commands.tasks.agents;
  const parts = [`${ui.assigned}=${formatAgent(task.assigned_to_agent_id, actorAgentId)}`];
  if (task.claimed_by_agent_id || task.status === "in_progress") {
    parts.push(`${ui.claimed}=${formatAgent(task.claimed_by_agent_id, actorAgentId)}`);
  }
  if (task.claim_expires_at) parts.push(`${ui.expires}=${relativeTime(task.claim_expires_at)}`);
  return parts.join(" · ");
}

function formatAgent(agentId: string | null, actorAgentId: string): string {
  const ui = piTasksMessages().commands.tasks.agents;
  if (!agentId) return ui.none;
  if (agentId === actorAgentId) return ui.me;
  return agentId;
}

function formatTimeLine(task: Task): string {
  const ui = piTasksMessages().commands.tasks.times;
  const parts = [`${ui.created}=${formatIso(task.created_at)}`, `${ui.updated}=${formatIso(task.updated_at)}`];
  if (task.started_at) parts.push(`${ui.started}=${formatIso(task.started_at)}`);
  if (task.completed_at) parts.push(`${ui.completed}=${formatIso(task.completed_at)}`);
  return parts.join(" · ");
}

function appendTextBlock(lines: string[], label: string, value: string | null): void {
  if (!value) return;
  lines.push(`   ${label}:`);
  for (const line of value.split(/\r?\n/)) {
    lines.push(`     ${line}`);
  }
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

function statusLabel(status: TaskStatus): string {
  return piTasksMessages().commands.tasks.statuses[status];
}

function formatIso(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
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

function openForCommand(ctx: ExtensionCommandContext): {
  service: TaskService;
  access: AccessOptions;
  warning?: string;
} {
  const resolved = resolvePiAgentId(ctx.sessionManager);
  const service = new TaskService({ cwd: ctx.cwd });
  return {
    service,
    access: { actor: { agentId: resolved.agentId, source: "pi" } },
    warning: resolved.warning,
  };
}

async function withOptionalBypass<T>(
  ctx: ExtensionCommandContext,
  commandName: string,
  fn: (service: TaskService, access: AccessOptions) => T,
): Promise<T> {
  const opened = openForCommand(ctx);
  try {
    try {
      return fn(opened.service, opened.access);
    } catch (error) {
      if (!(error instanceof PrivateListAccessError) || !ctx.hasUI) throw error;
      const bypass = piTasksMessages().commands.bypass;
      const confirmed = await ctx.ui.confirm(
        bypass.title,
        [
          `${bypass.commandSubject} /${commandName} ${bypass.commandAccess} ${error.list.id} (${error.list.name}).`,
          `${bypass.owner}: ${error.list.owner_agent_id ?? bypass.none}`,
          `${bypass.createdBy}: ${error.list.created_by_agent_id}`,
          `${bypass.currentAgent}: ${error.actorAgentId}`,
        ].join("\n"),
      );
      if (!confirmed) throw error;
      return fn(opened.service, {
        ...opened.access,
        privateBypass: {
          toolName: `/${commandName}`,
          reason: `${bypass.reasonPrefix} /${commandName}`,
        },
      });
    }
  } finally {
    opened.service.close();
  }
}
