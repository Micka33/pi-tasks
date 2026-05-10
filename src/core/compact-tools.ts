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
const TASK_TEXT_DISPLAY_MAX_CHARS = 96;
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

  const unwrapped = unwrapDisplayResult(envelope.result);
  const result = unwrapped.result;
  let text: string | undefined;

  if (envelope.operation === "task_lists.create" && isRecord(result)) text = formatCreatedList(result);
  if (envelope.operation === "task_lists.find" && Array.isArray(result)) text = formatFoundTaskLists(result);
  if (envelope.operation === "task_lists.get" && isRecord(result)) text = formatTaskListWithTasks(result);
  if (envelope.operation === "task_lists.delete" && isRecord(result)) text = formatDeletedTaskList(result);

  if (envelope.operation === "task_items.create" && isRecord(result)) text = formatCreatedTask(result);
  if (envelope.operation === "task_items.add_many" && Array.isArray(result)) text = formatAddedTasks(result);
  if (envelope.operation === "task_items.update" && isRecord(result)) text = formatUpdatedTask(result);
  if (envelope.operation === "task_items.reorder" && Array.isArray(result)) text = formatReorderedTasks(result);
  if (envelope.operation === "task_items.delete" && isRecord(result)) text = formatDeletedTask(result);

  if (envelope.operation === "task_claims.claim_next" && isRecord(result)) text = formatClaimNext(result);
  if (envelope.operation === "task_claims.refresh" && isRecord(result)) text = formatRefreshedClaim(result);
  if (envelope.operation === "task_claims.release_expired" && isRecord(result)) text = formatReleasedExpiredClaims(result);

  if (envelope.operation === "task_audit.get" && Array.isArray(result)) text = formatAuditEvents(result);

  if (envelope.operation === "task_help.all") text = formatAllHelp();
  if (envelope.operation === "task_help.workflow") text = formatWorkflowHelp();
  if (envelope.operation === "task_help.schemas") text = formatSchemaHelp();
  if (envelope.operation === "task_help.examples" && isRecord(result)) text = formatExamplesHelp(result);

  if (text !== undefined) return `${unwrapped.prefix}${text}`;
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

function unwrapDisplayResult(result: unknown): { result: unknown; prefix: string } {
  if (isRecord(result) && result.private_access_bypassed === true) {
    return { result: result.result, prefix: "⚠ Accès privé confirmé\n" };
  }
  return { result, prefix: "" };
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
  const nameWidth = Math.max("NAME".length, ...rows.map((row) => row.name.length));
  const visibilityWidth = "VISIBILITY".length;
  return [
    `✓ ${rows.length} liste${plural ? "s" : ""} trouvée${plural ? "s" : ""}`,
    `  ${"NAME".padEnd(nameWidth)}  ${"VISIBILITY".padEnd(visibilityWidth)}  ID`,
    ...rows.map((row) => `• ${row.name.padEnd(nameWidth)}  ${row.visibility.padEnd(visibilityWidth)}  ${row.id}`),
  ].join("\n");
}

function formatTaskListWithTasks(result: Record<string, unknown>): string {
  const list = result.list as Record<string, unknown>;
  const tasks = (result.tasks as unknown[]).filter(isRecord);
  const header = `${truncateOneLine(String(list.name), LIST_NAME_DISPLAY_MAX_CHARS)} · ${String(list.visibility)} · ${formatTaskCount(tasks.length)}`;
  if (tasks.length === 0) return header;

  const rows = tasks.map((task) => ({
    position: String(task.position),
    status: formatListTaskStatus(task.status),
    id: shortId(task.id),
    title: normalizeOneLine(String(task.title)),
  }));
  const positionWidth = Math.max("#".length, ...rows.map((row) => row.position.length));
  const statusWidth = Math.max("STATUS".length, ...rows.map((row) => row.status.length));
  const idWidth = Math.max("ID".length, ...rows.map((row) => row.id.length));
  return [
    header,
    formatListTaskStatusSummary(tasks),
    "",
    `  ${"#".padStart(positionWidth)}  ${"STATUS".padEnd(statusWidth)}  ${"ID".padEnd(idWidth)}  TITLE`,
    ...rows.map((row) => formatTaskListRow(row, { positionWidth, statusWidth, idWidth })),
  ].join("\n");
}

function formatTaskListRow(row: { position: string; status: string; id: string; title: string }, widths: { positionWidth: number; statusWidth: number; idWidth: number }): string {
  const prefix = `• ${row.position.padStart(widths.positionWidth)}  ${row.status.padEnd(widths.statusWidth)}  ${row.id.padEnd(widths.idWidth)}  `;
  return `${prefix}${truncateOneLine(row.title, TASK_ITEM_DISPLAY_LINE_MAX_CHARS - prefix.length)}`;
}

function formatListTaskStatusSummary(tasks: Array<Record<string, unknown>>): string {
  const counts: Array<[string, number]> = [
    ["todo", countTasksWithStatus(tasks, "todo")],
    ["run", countTasksWithStatus(tasks, "in_progress")],
    ["blocked", countTasksWithStatus(tasks, "blocked")],
    ["done", countTasksWithStatus(tasks, "done")],
    ["canceled", countTasksWithStatus(tasks, "canceled")],
  ];
  return counts
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
}

function countTasksWithStatus(tasks: Array<Record<string, unknown>>, status: string): number {
  return tasks.filter((task) => task.status === status).length;
}

function formatListTaskStatus(value: unknown): string {
  return value === "in_progress" ? "run" : String(value);
}

function formatTaskCount(count: number): string {
  if (count === 0) return "aucune tâche";
  if (count === 1) return "1 tâche";
  return `${count} tâches`;
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

function formatCreatedTask(task: Record<string, unknown>): string {
  return [`✓ Tâche créée: ${formatTaskReferenceWithDescription(task)}`, `  status: ${String(task.status)} · id: ${shortId(task.id)}`].join("\n");
}

function formatDeletedTask(task: Record<string, unknown>): string {
  return [`✓ Tâche supprimée: ${formatTaskReference(task)}`, `  status: ${String(task.status)} · id: ${shortId(task.id)}`].join("\n");
}

function formatReorderedTasks(tasks: unknown[]): string {
  const rows = tasks.filter(isRecord).map((task) => ({
    position: String(task.position),
    id: shortId(task.id),
    title: normalizeOneLine(String(task.title)),
  }));
  if (rows.length === 0) return "Aucune tâche réordonnée.";

  const plural = rows.length > 1;
  const positionWidth = Math.max("#".length, ...rows.map((row) => row.position.length));
  const idWidth = Math.max("ID".length, ...rows.map((row) => row.id.length));
  return [
    `✓ ${rows.length} tâche${plural ? "s" : ""} réordonnée${plural ? "s" : ""}`,
    `  ${"#".padStart(positionWidth)}  ${"ID".padEnd(idWidth)}  TITLE`,
    ...rows.map((row) => formatReorderedTaskRow(row, { positionWidth, idWidth })),
  ].join("\n");
}

function formatReorderedTaskRow(row: { position: string; id: string; title: string }, widths: { positionWidth: number; idWidth: number }): string {
  const prefix = `• ${row.position.padStart(widths.positionWidth)}  ${row.id.padEnd(widths.idWidth)}  `;
  return `${prefix}${truncateOneLine(row.title, TASK_ITEM_DISPLAY_LINE_MAX_CHARS - prefix.length)}`;
}

function formatAllHelp(): string {
  return [
    "pi-tasks help",
    "• workflow: claim_next, notes, outcome, private access",
    "• schemas: task_lists, task_items, task_claims, task_audit, task_help",
    "• examples: find, create, add_many, claim_next, update",
    "Use task_help workflow|schemas|examples for a focused section.",
  ].join("\n");
}

function formatWorkflowHelp(): string {
  return [
    "pi-tasks workflow",
    "1. Trouver/créer une liste: task_lists find/create",
    "2. Ajouter des tâches: task_items create/add_many",
    "3. Démarrer une tâche: task_claims claim_next",
    "4. Écrire la mémoire locale: task_items update notes",
    "5. Terminer: task_items update status=done + outcome",
  ].join("\n");
}

function formatSchemaHelp(): string {
  return [
    "pi-tasks schemas",
    `• task_lists: ${TASK_LIST_ACTIONS.join(", ")}`,
    `• task_items: ${TASK_ITEM_ACTIONS.join(", ")}`,
    `• task_claims: ${TASK_CLAIM_ACTIONS.join(", ")}`,
    `• task_audit: ${TASK_AUDIT_ACTIONS.join(", ")}`,
    `• task_help: ${TASK_HELP_ACTIONS.join(", ")}`,
    "Expand for full params.",
  ].join("\n");
}

function formatExamplesHelp(result: Record<string, unknown>): string {
  const examples = Array.isArray(result.examples) ? result.examples.filter(isRecord) : [];
  if (examples.length === 0) return "pi-tasks examples\nAucun exemple disponible.";
  return ["pi-tasks examples", ...examples.map(formatExampleLine)].join("\n");
}

function formatExampleLine(example: Record<string, unknown>, index: number): string {
  const input = isRecord(example.input) ? example.input : {};
  const action = typeof input.action === "string" ? input.action : "?";
  return `${index + 1}. ${String(example.tool)} ${action}`;
}

function formatClaimNext(result: Record<string, unknown>): string {
  if (!isRecord(result.task)) return "Aucune tâche disponible à claimer.";
  const task = result.task;
  return [
    `▶ Tâche claimée: ${formatTaskReference(task)}`,
    `  status: ${String(task.status)} · expires: ${formatExpiry(task.claim_expires_at)} · id: ${shortId(task.id)}`,
  ].join("\n");
}

function formatRefreshedClaim(task: Record<string, unknown>): string {
  return [
    `✓ Claim rafraîchi: ${formatTaskReference(task)}`,
    `  status: ${String(task.status)} · expires: ${formatExpiry(task.claim_expires_at)} · id: ${shortId(task.id)}`,
  ].join("\n");
}

function formatReleasedExpiredClaims(result: Record<string, unknown>): string {
  const released = Array.isArray(result.released) ? result.released.filter(isRecord) : [];
  if (released.length === 0) return "Aucun claim expiré à libérer.";

  const plural = released.length > 1;
  return [
    `✓ ${released.length} claim${plural ? "s" : ""} expiré${plural ? "s" : ""} libéré${plural ? "s" : ""}`,
    ...released.map((task) => `• ${formatTaskReference(task)} · id: ${shortId(task.id)}`),
  ].join("\n");
}

function formatUpdatedTask(task: Record<string, unknown>): string {
  const status = String(task.status);
  const prefixByStatus: Record<string, string> = {
    blocked: "⏸ Tâche bloquée",
    canceled: "✕ Tâche annulée",
    done: "✓ Tâche terminée",
  };
  const lines = [`${prefixByStatus[status] ?? "✓ Tâche mise à jour"}: ${formatTaskReference(task)}`, `  status: ${status} · id: ${shortId(task.id)}`];
  if (typeof task.notes === "string" && task.notes.trim().length > 0) lines.push(`  notes: ${truncateOneLine(task.notes, TASK_TEXT_DISPLAY_MAX_CHARS)}`);
  if (typeof task.outcome === "string" && task.outcome.trim().length > 0) lines.push(`  outcome: ${truncateOneLine(task.outcome, TASK_TEXT_DISPLAY_MAX_CHARS)}`);
  return lines.join("\n");
}

function formatTaskReference(task: Record<string, unknown>): string {
  return truncateOneLine(`#${String(task.position)} ${String(task.title)}`, TASK_ITEM_DISPLAY_LINE_MAX_CHARS);
}

function formatTaskReferenceWithDescription(task: Record<string, unknown>): string {
  const title = normalizeOneLine(String(task.title));
  const description = typeof task.description === "string" ? normalizeOneLine(task.description) : "";
  const body = description.length > 0 ? `${title} — ${description}` : title;
  return truncateOneLine(`#${String(task.position)} ${body}`, TASK_ITEM_DISPLAY_LINE_MAX_CHARS);
}

function formatExpiry(value: unknown): string {
  if (typeof value !== "string") return "?";
  const ms = Date.parse(value) - Date.now();
  if (!Number.isFinite(ms)) return "?";
  if (ms <= 0) return "expired";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `~${minutes}m`;
  return `~${Math.round(minutes / 60)}h`;
}

function shortId(value: unknown): string {
  return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : String(value);
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
  return formatTaskReferenceWithDescription(task);
}

function formatAuditEvents(events: unknown[]): string {
  const rows = events.filter(isRecord).map((event) => ({
    time: formatAuditTime(event.created_at),
    list: truncateOneLine(String(event.list_id), 24),
    actor: truncateOneLine(String(event.actor_agent_id), 24),
    tool: truncateOneLine(String(event.tool_name), 24),
    reason: typeof event.reason === "string" ? truncateOneLine(event.reason, TASK_TEXT_DISPLAY_MAX_CHARS) : "",
  }));
  if (rows.length === 0) return "Private access audit\nAucun événement visible.";

  const plural = rows.length > 1;
  const listWidth = Math.max("LIST".length, ...rows.map((row) => row.list.length));
  const actorWidth = Math.max("ACTOR".length, ...rows.map((row) => row.actor.length));
  const toolWidth = Math.max("TOOL".length, ...rows.map((row) => row.tool.length));
  return [
    `Private access audit · ${rows.length} événement${plural ? "s" : ""}`,
    `  TIME                  ${"LIST".padEnd(listWidth)}  ${"ACTOR".padEnd(actorWidth)}  ${"TOOL".padEnd(toolWidth)}`,
    ...rows.flatMap((row) => formatAuditEventLines(row, { listWidth, actorWidth, toolWidth })),
  ].join("\n");
}

function formatAuditEventLines(
  row: { time: string; list: string; actor: string; tool: string; reason: string },
  widths: { listWidth: number; actorWidth: number; toolWidth: number },
): string[] {
  const line = `• ${row.time.padEnd(20)}  ${row.list.padEnd(widths.listWidth)}  ${row.actor.padEnd(widths.actorWidth)}  ${row.tool.padEnd(widths.toolWidth)}`;
  return row.reason.length > 0 ? [line, `  reason: ${row.reason}`] : [line];
}

function formatAuditTime(value: unknown): string {
  if (typeof value !== "string") return "?";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "?";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
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
