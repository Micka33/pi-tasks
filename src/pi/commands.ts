import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { resolvePiAgentId } from "../core/agent-id.js";
import { PrivateListAccessError } from "../core/errors.js";
import { TaskService } from "../core/service.js";
import type { AccessOptions, DeleteTaskListResult, Task, TaskList, TaskListWithTasks, TaskStatus } from "../core/types.js";

export function registerPiTaskCommands(pi: ExtensionAPI): void {
  pi.registerCommand("task-store", {
    description: "Show the SQLite database path used by pi-tasks",
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
    description: "Show the current pi-tasks agent id derived from the Pi session",
    handler: async (_args, ctx) => {
      const resolved = resolvePiAgentId(ctx.sessionManager);
      if (resolved.warning) ctx.ui.notify(resolved.warning, "warning");
      ctx.ui.notify(resolved.agentId, "info");
    },
  });

  pi.registerCommand("task-lists", {
    description: "Show visible task lists. Default: name/id only. Use /task-lists full for complete JSON.",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      const full = arg === "full" || arg === "--full" || arg === "-f";
      if (arg && !full) {
        ctx.ui.notify("Usage: /task-lists [full]", "error");
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
    description: "Show one task list. Default: readable task details. Use /tasks <list_id> full for complete JSON.",
    handler: async (args, ctx) => {
      const parsed = parseTasksArgs(args);
      if (!parsed) {
        ctx.ui.notify("Usage: /tasks <list_id> [full]", "error");
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
    description: "Soft-delete a task list and all active tasks in it: /task-list-delete <list_id>",
    handler: async (args, ctx) => {
      const listId = args.trim();
      if (!listId || /\s/.test(listId)) {
        ctx.ui.notify("Usage: /task-list-delete <list_id>", "error");
        return;
      }

      const output = await withOptionalBypass(ctx, "task-list-delete", (service, access) => {
        return formatTaskListDeleteCommandOutput(service.deleteTaskList({ list_id: listId }, access));
      });
      ctx.ui.notify(output, "info");
    },
  });
}

export function formatTaskListsCommandOutput(lists: TaskList[], options: { full?: boolean } = {}): string {
  if (options.full) return JSON.stringify(lists, null, 2);
  if (lists.length === 0) return "No visible task lists.";
  return lists.map((list) => `- name: ${list.name}\n  id: ${list.id}`).join("\n");
}

export function formatTaskListDeleteCommandOutput(result: DeleteTaskListResult): string {
  const lines = [
    "Deleted task list:",
    `- name: ${result.list.name}`,
    `  id: ${result.list.id}`,
    `  deleted_at: ${result.list.deleted_at ?? "already deleted"}`,
    `  active tasks deleted: ${result.deleted_tasks.length}`,
  ];
  return lines.join("\n");
}

export function formatTasksCommandOutput(data: TaskListWithTasks, actorAgentId: string): string {
  const { list, tasks } = data;
  const lines: string[] = [];
  lines.push(list.name);
  lines.push(`id: ${list.id} · ${list.scope_type} · ${list.visibility}`);
  lines.push(`counts: ${formatCounts(countTasks(tasks))}`);

  if (tasks.length === 0) {
    lines.push("");
    lines.push("No tasks in this list.");
    return lines.join("\n");
  }

  for (const task of tasks) {
    lines.push("");
    lines.push(`#${task.position} ${statusGlyph(task.status)} ${statusLabel(task.status)} · ${task.title} (${task.id})`);
    lines.push(`   ${formatAgentLine(task, actorAgentId)}`);
    lines.push(`   ${formatTimeLine(task)}`);
    appendTextBlock(lines, "description", task.description);
    appendTextBlock(lines, "notes", task.notes);
    appendTextBlock(lines, "outcome", task.outcome);
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
  return [
    `todo ${counts.todo}`,
    `run ${counts.in_progress}`,
    `blocked ${counts.blocked}`,
    `done ${counts.done}`,
    `canceled ${counts.canceled}`,
  ].join(" · ");
}

function formatAgentLine(task: Task, actorAgentId: string): string {
  const parts = [`assigned=${formatAgent(task.assigned_to_agent_id, actorAgentId)}`];
  if (task.claimed_by_agent_id || task.status === "in_progress") {
    parts.push(`claimed=${formatAgent(task.claimed_by_agent_id, actorAgentId)}`);
  }
  if (task.claim_expires_at) parts.push(`expires=${relativeTime(task.claim_expires_at)}`);
  return parts.join(" · ");
}

function formatAgent(agentId: string | null, actorAgentId: string): string {
  if (!agentId) return "none";
  if (agentId === actorAgentId) return "me";
  return agentId;
}

function formatTimeLine(task: Task): string {
  const parts = [`created=${formatIso(task.created_at)}`, `updated=${formatIso(task.updated_at)}`];
  if (task.started_at) parts.push(`started=${formatIso(task.started_at)}`);
  if (task.completed_at) parts.push(`completed=${formatIso(task.completed_at)}`);
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
  switch (status) {
    case "todo":
      return "todo";
    case "in_progress":
      return "run";
    case "blocked":
      return "paused";
    case "done":
      return "done";
    case "canceled":
      return "canceled";
  }
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
      const confirmed = await ctx.ui.confirm(
        "Bypass private pi-tasks list?",
        [
          `Command /${commandName} needs access to private list ${error.list.id} (${error.list.name}).`,
          `Owner: ${error.list.owner_agent_id ?? "<none>"}`,
          `Created by: ${error.list.created_by_agent_id}`,
          `Current agent: ${error.actorAgentId}`,
        ].join("\n"),
      );
      if (!confirmed) throw error;
      return fn(opened.service, {
        ...opened.access,
        privateBypass: {
          toolName: `/${commandName}`,
          reason: `User confirmed private-list bypass in Pi command /${commandName}`,
        },
      });
    }
  } finally {
    opened.service.close();
  }
}
