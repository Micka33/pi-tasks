import { ValidationError } from "./errors.js";
export const COMPACT_TOOL_NAMES = ["task_lists", "task_items", "task_claims", "task_audit", "task_help"];
export const TASK_LIST_ACTIONS = ["create", "find", "get", "delete"];
export const TASK_ITEM_ACTIONS = ["create", "add_many", "update", "reorder", "delete"];
export const TASK_CLAIM_ACTIONS = ["claim_next", "refresh", "release_expired"];
export const TASK_AUDIT_ACTIONS = ["get"];
export const TASK_HELP_ACTIONS = ["all", "workflow", "schemas", "examples"];
const TASK_ITEM_DISPLAY_LINE_MAX_CHARS = 96;
const TASK_TEXT_DISPLAY_MAX_CHARS = 96;
const LIST_NAME_DISPLAY_MAX_CHARS = 80;
const TASK_LIST_FIND_NAME_MAX_CHARS = 40;
const TASK_LIST_FIND_ID_MAX_CHARS = 48;
export function dispatchCompactTaskTool(service, toolName, input, access) {
    if (toolName === "task_help")
        return getTaskHelp(input);
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
export function compactToolAction(toolName, input) {
    if (toolName === "task_help" && input === undefined)
        return "all";
    if (!isRecord(input))
        return undefined;
    if (toolName === "task_help" && input.action === undefined)
        return "all";
    if (typeof input.action !== "string")
        return undefined;
    if (toolName === "task_help" && input.action.trim().length === 0)
        return undefined;
    return input.action;
}
export function compactToolCallName(toolName, input) {
    const action = compactToolAction(toolName, input);
    return action === undefined ? toolName : `${toolName}.${action}`;
}
export function compactToolResultEnvelope(toolName, input, result) {
    const action = compactToolAction(toolName, input);
    return {
        operation: compactToolCallName(toolName, input),
        tool: toolName,
        ...(action === undefined ? {} : { action }),
        result,
    };
}
export function formatCompactToolDisplay(envelope) {
    if (!isRecord(envelope))
        return JSON.stringify(envelope, null, 2);
    if (envelope.operation === "task_lists.create" && isRecord(envelope.result))
        return formatCreatedList(envelope.result);
    if (envelope.operation === "task_lists.find" && Array.isArray(envelope.result))
        return formatFoundTaskLists(envelope.result);
    if (envelope.operation === "task_lists.delete" && isRecord(envelope.result))
        return formatDeletedTaskList(envelope.result);
    if (envelope.operation === "task_help.workflow")
        return formatWorkflowHelp();
    if (envelope.operation === "task_claims.claim_next" && isRecord(envelope.result))
        return formatClaimNext(envelope.result);
    if (envelope.operation === "task_items.add_many" && Array.isArray(envelope.result))
        return formatAddedTasks(envelope.result);
    if (envelope.operation === "task_items.update" && isRecord(envelope.result))
        return formatUpdatedTask(envelope.result);
    return JSON.stringify(envelope, null, 2);
}
export function getTaskHelp(input) {
    const rawAction = input === undefined ? undefined : readOptionalAction(input);
    const action = rawAction ?? "all";
    assertAllowedAction(action, TASK_HELP_ACTIONS, "task_help");
    const sections = {
        workflow: TASK_WORKFLOW_HELP,
        schemas: TASK_SCHEMA_HELP,
        examples: TASK_EXAMPLES_HELP,
    };
    if (action === "all")
        return sections;
    const sectionName = action;
    return { [sectionName]: sections[sectionName] };
}
function runTaskListsAction(service, request, access) {
    assertAllowedAction(request.action, TASK_LIST_ACTIONS, "task_lists");
    switch (request.action) {
        case "create":
            return service.createTaskList(request.params, access);
        case "find":
            return service.findTaskLists(request.params, access);
        case "get":
            return service.getTaskList(request.params, access);
        case "delete":
            return service.deleteTaskList(request.params, access);
    }
}
function runTaskItemsAction(service, request, access) {
    assertAllowedAction(request.action, TASK_ITEM_ACTIONS, "task_items");
    switch (request.action) {
        case "create":
            return service.createTask(request.params, access);
        case "add_many":
            return service.addManyTasks(request.params, access);
        case "update":
            return service.updateTask(request.params, access);
        case "reorder":
            return service.reorderTasks(request.params, access);
        case "delete":
            return service.deleteTask(request.params, access);
    }
}
function runTaskClaimsAction(service, request, access) {
    assertAllowedAction(request.action, TASK_CLAIM_ACTIONS, "task_claims");
    switch (request.action) {
        case "claim_next":
            return service.claimNextTask(request.params, access);
        case "refresh":
            return service.refreshClaim(request.params, access);
        case "release_expired":
            return service.releaseExpiredClaims(request.params, access);
    }
}
function runTaskAuditAction(service, request, access) {
    assertAllowedAction(request.action, TASK_AUDIT_ACTIONS, "task_audit");
    return service.getPrivateAccessEvents(request.params, access);
}
function formatCreatedList(list) {
    return `✓ Liste créée: ${truncateOneLine(String(list.name), LIST_NAME_DISPLAY_MAX_CHARS)} · ${String(list.visibility)}`;
}
function formatFoundTaskLists(lists) {
    const rows = lists.filter(isRecord).map((list) => ({
        name: truncateOneLine(String(list.name), TASK_LIST_FIND_NAME_MAX_CHARS),
        visibility: truncateOneLine(String(list.visibility), "private".length),
        id: truncateOneLine(String(list.id), TASK_LIST_FIND_ID_MAX_CHARS),
    }));
    if (rows.length === 0)
        return "Aucune liste trouvée.";
    const plural = rows.length > 1;
    const nameWidth = Math.max("NAME".length, ...rows.map((row) => row.name.length));
    const visibilityWidth = "VISIBILITY".length;
    return [
        `✓ ${rows.length} liste${plural ? "s" : ""} trouvée${plural ? "s" : ""}`,
        `  ${"NAME".padEnd(nameWidth)}  ${"VISIBILITY".padEnd(visibilityWidth)}  ID`,
        ...rows.map((row) => `• ${row.name.padEnd(nameWidth)}  ${row.visibility.padEnd(visibilityWidth)}  ${row.id}`),
    ].join("\n");
}
function formatDeletedTaskList(result) {
    const list = result.list;
    const deletedTasks = result.deleted_tasks;
    return `✓ Liste supprimée: ${truncateOneLine(String(list.name), LIST_NAME_DISPLAY_MAX_CHARS)} · ${String(list.visibility)} · ${formatDeletedTaskCount(deletedTasks.length)}`;
}
function formatDeletedTaskCount(count) {
    if (count === 0)
        return "aucune tâche active";
    if (count === 1)
        return "1 tâche supprimée";
    return `${count} tâches supprimées`;
}
function formatWorkflowHelp() {
    return [
        "pi-tasks workflow",
        "1. Trouver/créer une liste: task_lists find/create",
        "2. Ajouter des tâches: task_items create/add_many",
        "3. Démarrer une tâche: task_claims claim_next",
        "4. Écrire la mémoire locale: task_items update notes",
        "5. Terminer: task_items update status=done + outcome",
    ].join("\n");
}
function formatClaimNext(result) {
    if (!isRecord(result.task))
        return "Aucune tâche disponible à claimer.";
    const task = result.task;
    return [
        `▶ Tâche claimée: ${formatTaskReference(task)}`,
        `  status: ${String(task.status)} · expires: ${formatExpiry(task.claim_expires_at)} · id: ${shortId(task.id)}`,
    ].join("\n");
}
function formatUpdatedTask(task) {
    const status = String(task.status);
    const prefixByStatus = {
        blocked: "⏸ Tâche bloquée",
        canceled: "✕ Tâche annulée",
        done: "✓ Tâche terminée",
    };
    const lines = [`${prefixByStatus[status] ?? "✓ Tâche mise à jour"}: ${formatTaskReference(task)}`, `  status: ${status} · id: ${shortId(task.id)}`];
    if (typeof task.notes === "string" && task.notes.trim().length > 0)
        lines.push(`  notes: ${truncateOneLine(task.notes, TASK_TEXT_DISPLAY_MAX_CHARS)}`);
    if (typeof task.outcome === "string" && task.outcome.trim().length > 0)
        lines.push(`  outcome: ${truncateOneLine(task.outcome, TASK_TEXT_DISPLAY_MAX_CHARS)}`);
    return lines.join("\n");
}
function formatTaskReference(task) {
    return truncateOneLine(`#${String(task.position)} ${String(task.title)}`, TASK_ITEM_DISPLAY_LINE_MAX_CHARS);
}
function formatExpiry(value) {
    if (typeof value !== "string")
        return "?";
    const ms = Date.parse(value) - Date.now();
    if (!Number.isFinite(ms))
        return "?";
    if (ms <= 0)
        return "expired";
    const minutes = Math.ceil(ms / 60_000);
    if (minutes < 60)
        return `~${minutes}m`;
    return `~${Math.round(minutes / 60)}h`;
}
function shortId(value) {
    return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : String(value);
}
function formatAddedTasks(tasks) {
    const plural = tasks.length > 1;
    const lines = [`✓ ${tasks.length} tâche${plural ? "s" : ""} ajoutée${plural ? "s" : ""}`];
    for (const item of tasks) {
        if (isRecord(item))
            lines.push(formatAddedTaskLine(item));
    }
    return lines.join("\n");
}
function formatAddedTaskLine(task) {
    const title = normalizeOneLine(String(task.title));
    const description = typeof task.description === "string" ? normalizeOneLine(task.description) : "";
    const body = description.length > 0 ? `${title} — ${description}` : title;
    return truncateOneLine(`#${String(task.position)} ${body}`, TASK_ITEM_DISPLAY_LINE_MAX_CHARS);
}
function normalizeOneLine(value) {
    return value.replace(/\s+/g, " ").trim();
}
function truncateOneLine(value, maxChars) {
    const normalized = normalizeOneLine(value);
    return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}
function parseCompactRequest(input) {
    if (!isRecord(input)) {
        throw new ValidationError("Compact pi-tasks tool input must be an object with action and optional params", { input });
    }
    if (typeof input.action !== "string" || input.action.trim().length === 0) {
        throw new ValidationError("action is required", { action: input.action });
    }
    return { action: input.action, params: readParams(input) };
}
function readOptionalAction(input) {
    if (!isRecord(input)) {
        throw new ValidationError("task_help input must be an object", { input });
    }
    if (input.action === undefined)
        return undefined;
    if (typeof input.action !== "string" || input.action.trim().length === 0) {
        throw new ValidationError("task_help action must be a non-empty string", { action: input.action });
    }
    return input.action;
}
function readParams(input) {
    if (input.params === undefined)
        return {};
    if (!isRecord(input.params)) {
        throw new ValidationError("params must be an object when provided", { params: input.params });
    }
    return input.params;
}
function assertAllowedAction(action, allowed, toolName) {
    if (!allowed.includes(action)) {
        throw new ValidationError(`Invalid action for ${toolName}: ${action}`, { action, allowed });
    }
}
function isRecord(value) {
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
//# sourceMappingURL=compact-tools.js.map