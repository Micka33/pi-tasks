import { ValidationError } from "./errors.js";
import type { AccessOptions } from "./types.js";
import type { TaskService } from "./service.js";

export const COMPACT_TOOL_NAMES = ["task_lists", "task_items", "task_claims", "task_audit", "task_help"] as const;
export const TASK_LIST_ACTIONS = ["create", "find", "get", "delete"] as const;
export const TASK_ITEM_ACTIONS = ["create", "add_many", "update", "reorder", "delete"] as const;
export const TASK_CLAIM_ACTIONS = ["claim_next", "refresh", "release_expired"] as const;
export const TASK_AUDIT_ACTIONS = ["get"] as const;
export const TASK_HELP_ACTIONS = ["all", "workflow", "schemas", "examples"] as const;

export type CompactToolName = (typeof COMPACT_TOOL_NAMES)[number];

const TASK_ITEM_DISPLAY_LINE_MAX_CHARS = 96;
const LIST_NAME_DISPLAY_MAX_CHARS = 80;
const TASK_LIST_FIND_NAME_MAX_CHARS = 40;
const TASK_LIST_FIND_ID_MAX_CHARS = 48;

interface CompactRequest {
  action: string;
  params: Record<string, unknown>;
}

export function dispatchCompactTaskTool(
  service: TaskService,
  toolName: string,
  input: unknown,
  access: AccessOptions,
): unknown {
  if (toolName === "task_help") return getTaskHelp(input);

  const request = parseCompactRequest(input);
  switch (toolName) {
    case "task_lists":
      return runTaskListsAction(service, request, access);
    case "task_items":
      return runTaskItemsAction(service, request, access);
    case "task_claims":
      return runTaskClaimsAction(service, request, access);
    case "task_audit":
      return runTaskAuditAction(service, request, access);
    default:
      throw new ValidationError(`Unknown compact pi-tasks tool: ${toolName}`, { tool_name: toolName, allowed: COMPACT_TOOL_NAMES });
  }
}

export function compactToolAction(toolName: string, input: unknown): string | undefined {
  if (toolName === "task_help" && input === undefined) return "all";
  if (!isRecord(input)) return undefined;
  if (toolName === "task_help" && input.action === undefined) return "all";
  if (typeof input.action !== "string") return undefined;
  if (toolName === "task_help" && input.action.trim().length === 0) return undefined;
  return input.action;
}

export function compactToolCallName(toolName: string, input: unknown): string {
  const action = compactToolAction(toolName, input);
  return action === undefined ? toolName : `${toolName}.${action}`;
}

export function compactToolResultEnvelope(toolName: string, input: unknown, result: unknown): Record<string, unknown> {
  const action = compactToolAction(toolName, input);
  return {
    operation: compactToolCallName(toolName, input),
    tool: toolName,
    ...(action === undefined ? {} : { action }),
    result,
  };
}

export function formatCompactToolDisplay(envelope: unknown): string {
  if (!isRecord(envelope)) return JSON.stringify(envelope, null, 2);
  if (envelope.operation === "task_lists.create" && isRecord(envelope.result)) return formatCreatedList(envelope.result);
  if (envelope.operation === "task_lists.find" && Array.isArray(envelope.result)) return formatFoundTaskLists(envelope.result);
  if (envelope.operation === "task_lists.delete" && isRecord(envelope.result)) return formatDeletedTaskList(envelope.result);
  if (envelope.operation === "task_items.add_many" && Array.isArray(envelope.result)) return formatAddedTasks(envelope.result);
  return JSON.stringify(envelope, null, 2);
}

export function getTaskHelp(input?: unknown): Record<string, unknown> {
  const rawAction = input === undefined ? undefined : readOptionalAction(input);
  const action = rawAction ?? "all";
  assertAllowedAction(action, TASK_HELP_ACTIONS, "task_help");

  const sections = {
    workflow: TASK_WORKFLOW_HELP,
    schemas: TASK_SCHEMA_HELP,
    examples: TASK_EXAMPLES_HELP,
  };
  if (action === "all") return sections;
  const sectionName = action as keyof typeof sections;
  return { [sectionName]: sections[sectionName] };
}

function runTaskListsAction(service: TaskService, request: CompactRequest, access: AccessOptions): unknown {
  assertAllowedAction(request.action, TASK_LIST_ACTIONS, "task_lists");
  switch (request.action) {
    case "create":
      return service.createTaskList(request.params as never, access);
    case "find":
      return service.findTaskLists(request.params as never, access);
    case "get":
      return service.getTaskList(request.params as never, access);
    case "delete":
      return service.deleteTaskList(request.params as never, access);
  }
}

function runTaskItemsAction(service: TaskService, request: CompactRequest, access: AccessOptions): unknown {
  assertAllowedAction(request.action, TASK_ITEM_ACTIONS, "task_items");
  switch (request.action) {
    case "create":
      return service.createTask(request.params as never, access);
    case "add_many":
      return service.addManyTasks(request.params as never, access);
    case "update":
      return service.updateTask(request.params as never, access);
    case "reorder":
      return service.reorderTasks(request.params as never, access);
    case "delete":
      return service.deleteTask(request.params as never, access);
  }
}

function runTaskClaimsAction(service: TaskService, request: CompactRequest, access: AccessOptions): unknown {
  assertAllowedAction(request.action, TASK_CLAIM_ACTIONS, "task_claims");
  switch (request.action) {
    case "claim_next":
      return service.claimNextTask(request.params as never, access);
    case "refresh":
      return service.refreshClaim(request.params as never, access);
    case "release_expired":
      return service.releaseExpiredClaims(request.params as never, access);
  }
}

function runTaskAuditAction(service: TaskService, request: CompactRequest, access: AccessOptions): unknown {
  assertAllowedAction(request.action, TASK_AUDIT_ACTIONS, "task_audit");
  return service.getPrivateAccessEvents(request.params as never, access);
}

function formatCreatedList(list: Record<string, unknown>): string {
  return `✓ Liste créée: ${truncateOneLine(String(list.name), LIST_NAME_DISPLAY_MAX_CHARS)} · ${String(list.visibility)}`;
}

function formatFoundTaskLists(lists: unknown[]): string {
  const rows = lists.filter(isRecord).map((list) => ({
    name: truncateOneLine(String(list.name), TASK_LIST_FIND_NAME_MAX_CHARS),
    visibility: truncateOneLine(String(list.visibility), "private".length),
    id: truncateOneLine(String(list.id), TASK_LIST_FIND_ID_MAX_CHARS),
  }));
  if (rows.length === 0) return "Aucune liste trouvée.";

  const plural = rows.length > 1;
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const visibilityWidth = "private".length;
  return [
    `✓ ${rows.length} liste${plural ? "s" : ""} trouvée${plural ? "s" : ""}`,
    ...rows.map((row) => `• ${row.name.padEnd(nameWidth)}  ${row.visibility.padEnd(visibilityWidth)}  ${row.id}`),
  ].join("\n");
}

function formatDeletedTaskList(result: Record<string, unknown>): string {
  const list = result.list as Record<string, unknown>;
  const deletedTasks = result.deleted_tasks as unknown[];
  return `✓ Liste supprimée: ${truncateOneLine(String(list.name), LIST_NAME_DISPLAY_MAX_CHARS)} · ${String(list.visibility)} · ${formatDeletedTaskCount(deletedTasks.length)}`;
}

function formatDeletedTaskCount(count: number): string {
  if (count === 0) return "aucune tâche active";
  if (count === 1) return "1 tâche supprimée";
  return `${count} tâches supprimées`;
}

function formatAddedTasks(tasks: unknown[]): string {
  const plural = tasks.length > 1;
  const lines = [`✓ ${tasks.length} tâche${plural ? "s" : ""} ajoutée${plural ? "s" : ""}`];
  for (const item of tasks) {
    if (isRecord(item)) lines.push(formatAddedTaskLine(item));
  }
  return lines.join("\n");
}

function formatAddedTaskLine(task: Record<string, unknown>): string {
  const title = normalizeOneLine(String(task.title));
  const description = typeof task.description === "string" ? normalizeOneLine(task.description) : "";
  const body = description.length > 0 ? `${title} — ${description}` : title;
  return truncateOneLine(`#${String(task.position)} ${body}`, TASK_ITEM_DISPLAY_LINE_MAX_CHARS);
}

function normalizeOneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateOneLine(value: string, maxChars: number): string {
  const normalized = normalizeOneLine(value);
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

function parseCompactRequest(input: unknown): CompactRequest {
  if (!isRecord(input)) {
    throw new ValidationError("Compact pi-tasks tool input must be an object with action and optional params", { input });
  }
  if (typeof input.action !== "string" || input.action.trim().length === 0) {
    throw new ValidationError("action is required", { action: input.action });
  }
  return { action: input.action, params: readParams(input) };
}

function readOptionalAction(input: unknown): string | undefined {
  if (!isRecord(input)) {
    throw new ValidationError("task_help input must be an object", { input });
  }
  if (input.action === undefined) return undefined;
  if (typeof input.action !== "string" || input.action.trim().length === 0) {
    throw new ValidationError("task_help action must be a non-empty string", { action: input.action });
  }
  return input.action;
}

function readParams(input: Record<string, unknown>): Record<string, unknown> {
  if (input.params === undefined) return {};
  if (!isRecord(input.params)) {
    throw new ValidationError("params must be an object when provided", { params: input.params });
  }
  return input.params;
}

function assertAllowedAction(action: string, allowed: readonly string[], toolName: string): void {
  if (!allowed.includes(action)) {
    throw new ValidationError(`Invalid action for ${toolName}: ${action}`, { action, allowed });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TASK_WORKFLOW_HELP = [
  "Use task_lists action=find/get/create/delete to discover or manage lists.",
  "Use task_items action=create/add_many to populate a list.",
  "Use task_claims action=claim_next as the only normal way to move work to in_progress.",
  "Use task_claims action=refresh for long-running work; it refreshes claim_expires_at without changing started_at.",
  "Use task_items action=update with notes for task-local working memory.",
  "Close tasks with task_items action=update and status done or canceled; outcome is required and should summarize decisions, actions, and final state.",
  "Pause tasks with status blocked. If assigned_to_agent_id is omitted, responsibility stays with the pausing agent; pass null to release it.",
  "Private lists are enforced. If access is denied, explain why explicit user-confirmed bypass is needed.",
];

const TASK_SCHEMA_HELP = {
  task_lists: {
    create: "params: { id?, name, scope_type, scope_key, visibility?, owner_agent_id? }",
    find: "params: { scope_type?, scope_key?, visibility?, owner_agent_id?, created_by_agent_id?, name?, include_deleted?, include_inaccessible_private? }",
    get: "params: { list_id, statuses?, include_deleted? }",
    delete: "params: { list_id }",
  },
  task_items: {
    create: "params: { id?, list_id, title, description?, notes?, position?, assigned_to_agent_id? }",
    add_many: "params: { list_id, tasks: [{ id?, title, description?, notes?, assigned_to_agent_id? }] }",
    update: "params: { task_id, title?, description?, notes?, status?, assigned_to_agent_id?, outcome? }",
    reorder: "params: { list_id, task_ids }",
    delete: "params: { task_id }",
  },
  task_claims: {
    claim_next: "params: { list_id, claim_ttl_seconds?, release_expired_first? }",
    refresh: "params: { task_id, claim_ttl_seconds? }",
    release_expired: "params: { list_id? }",
  },
  task_audit: {
    get: "params: { list_id?, actor_agent_id?, tool_name?, since?, limit? }",
  },
  task_help: {
    all: "{ action?: 'all' | 'workflow' | 'schemas' | 'examples' }",
  },
};

const TASK_EXAMPLES_HELP = [
  { tool: "task_lists", input: { action: "find", params: { scope_type: "workspace", scope_key: "/repo" } } },
  { tool: "task_lists", input: { action: "create", params: { name: "Release work", scope_type: "workspace", scope_key: "/repo" } } },
  { tool: "task_items", input: { action: "add_many", params: { list_id: "release", tasks: [{ title: "Run tests" }] } } },
  { tool: "task_claims", input: { action: "claim_next", params: { list_id: "release" } } },
  { tool: "task_items", input: { action: "update", params: { task_id: "task-id", status: "done", outcome: "Decision: ship. Actions: tests. Final state: green." } } },
];
