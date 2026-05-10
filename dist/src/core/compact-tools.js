import { ValidationError } from "./errors.js";
export const COMPACT_TOOL_NAMES = ["task_lists", "task_items", "task_claims", "task_audit", "task_help"];
export const TASK_LIST_ACTIONS = ["create", "find", "get", "delete"];
export const TASK_ITEM_ACTIONS = ["create", "add_many", "update", "reorder", "delete"];
export const TASK_CLAIM_ACTIONS = ["claim_next", "refresh", "release_expired"];
export const TASK_AUDIT_ACTIONS = ["get"];
export const TASK_HELP_ACTIONS = ["all", "workflow", "schemas", "examples"];
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
export function compactToolCallName(toolName, input) {
    if (!isRecord(input) || typeof input.action !== "string")
        return toolName;
    return `${toolName}.${input.action}`;
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