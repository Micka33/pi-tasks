import { PrivateListAccessError, serializeError } from "../core/errors.js";
import { resolvePiAgentId } from "../core/agent-id.js";
import { TaskService } from "../core/service.js";
import { TaskAddManyParams, TaskClaimNextParams, TaskClaimRefreshParams, TaskCreateParams, TaskDeleteParams, TaskListCreateParams, TaskListDeleteParams, TaskListGetParams, TaskListsFindParams, TaskReleaseExpiredClaimsParams, TaskReorderParams, TaskUpdateParams, } from "./schemas.js";
const CLAIM_GUIDELINES = [
    "Use task_claim_next as the only normal way to move a task to in_progress; never use task_update to set in_progress.",
    "Use task_claim_refresh to extend a long-running claim; it updates claim_expires_at without changing started_at.",
    "Use task_update(notes=...) as task-local memory for important context, choices in progress, blockers, and next steps while working.",
    "After executing a claimed task, use task_update to set done, blocked, todo, or canceled.",
    "When closing a task with status done or canceled, include outcome with choices/decisions, actions taken, and the final state obtained.",
    "When pausing with task_update(status='blocked'), omit assigned_to_agent_id to keep the task assigned to the pausing agent; pass assigned_to_agent_id:null to release it completely.",
    "Respect assigned_to_agent_id: task_claim_next only returns unassigned tasks or tasks assigned to the current agent.",
    "Private task lists are enforced by pi-tasks; if access is denied, explain why a user-confirmed bypass is needed.",
];
export function registerPiTaskTools(pi) {
    const tools = [
        {
            name: "task_list_create",
            label: "Create Task List",
            description: "Create a persistent task list. The current Pi session becomes created_by_agent_id; private lists default to the current Pi session as owner.",
            promptSnippet: "Create a persistent ordered task list for one or more agents.",
            parameters: TaskListCreateParams,
            run: (service, params, access) => service.createTaskList(params, access),
        },
        {
            name: "task_lists_find",
            label: "Find Task Lists",
            description: "Find task lists by scope, visibility, owner, creator, or name. Inaccessible private lists are hidden unless include_inaccessible_private is requested and the user confirms a bypass.",
            promptSnippet: "Find existing task lists by scope, owner, visibility, or name.",
            parameters: TaskListsFindParams,
            run: (service, params, access) => service.findTaskLists(params, access),
        },
        {
            name: "task_list_get",
            label: "Get Task List",
            description: "Read a task list and its tasks in execution order. Deleted tasks are hidden unless include_deleted is true.",
            promptSnippet: "Read a task list and its tasks in position order.",
            parameters: TaskListGetParams,
            run: (service, params, access) => service.getTaskList(params, access),
        },
        {
            name: "task_list_delete",
            label: "Delete Task List",
            description: "Soft-delete a task list and all active tasks in it by setting deleted_at. Claims are cleared; rows remain in SQLite for audit/history.",
            promptSnippet: "Soft-delete a task list and all active tasks it contains.",
            parameters: TaskListDeleteParams,
            run: (service, params, access) => service.deleteTaskList(params, access),
        },
        {
            name: "task_create",
            label: "Create Task",
            description: "Add a single todo task to a task list, optionally at a specific 1-based position.",
            promptSnippet: "Add a single task to a persistent task list.",
            parameters: TaskCreateParams,
            run: (service, params, access) => service.createTask(params, access),
        },
        {
            name: "task_add_many",
            label: "Add Many Tasks",
            description: "Add multiple todo tasks to a task list in one transaction.",
            promptSnippet: "Add multiple tasks to a task list atomically.",
            parameters: TaskAddManyParams,
            run: (service, params, access) => service.addManyTasks(params, access),
        },
        {
            name: "task_claim_next",
            label: "Claim Next Task",
            description: "Atomically claim the next todo task for the current Pi session. This is the only normal way to move a task to in_progress.",
            promptSnippet: "Atomically claim the next todo task for the current agent.",
            parameters: TaskClaimNextParams,
            run: (service, params, access) => service.claimNextTask(params, access),
        },
        {
            name: "task_claim_refresh",
            label: "Refresh Task Claim",
            description: "Refresh the current agent's claim on an in_progress task. Updates claim_expires_at without changing started_at.",
            promptSnippet: "Extend a claimed task's expiration without changing its started_at timestamp.",
            parameters: TaskClaimRefreshParams,
            run: (service, params, access) => service.refreshClaim(params, access),
        },
        {
            name: "task_update",
            label: "Update Task",
            description: "Update task fields, notes, outcome, or status. Notes are task-local working memory. Setting status to in_progress is rejected; use task_claim_next instead. Closing a task as done/canceled requires outcome with choices/decisions, actions taken, and final state obtained. Setting status to blocked keeps assignment on the pausing agent unless assigned_to_agent_id:null is passed.",
            promptSnippet: "Update a task outcome, notes, assignment, or terminal/blocking status.",
            parameters: TaskUpdateParams,
            run: (service, params, access) => service.updateTask(params, access),
        },
        {
            name: "task_reorder",
            label: "Reorder Tasks",
            description: "Reorder active tasks in a list. Provided task_ids are placed first; omitted active tasks keep relative order after them.",
            promptSnippet: "Reorder tasks in a task list.",
            parameters: TaskReorderParams,
            run: (service, params, access) => service.reorderTasks(params, access),
        },
        {
            name: "task_release_expired_claims",
            label: "Release Expired Claims",
            description: "Release expired in_progress claims back to todo without clearing started_at.",
            promptSnippet: "Release expired claims so abandoned tasks can be claimed again.",
            parameters: TaskReleaseExpiredClaimsParams,
            run: (service, params, access) => service.releaseExpiredClaims(params, access),
        },
        {
            name: "task_delete",
            label: "Delete Task",
            description: "Soft-delete a task by setting deleted_at. The row remains in SQLite for audit/history.",
            promptSnippet: "Soft-delete a task without physically removing its row.",
            parameters: TaskDeleteParams,
            run: (service, params, access) => service.deleteTask(params, access),
        },
    ];
    for (const tool of tools) {
        pi.registerTool({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            promptSnippet: tool.promptSnippet,
            promptGuidelines: CLAIM_GUIDELINES,
            parameters: tool.parameters,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                return executePiTaskTool(tool, params, ctx);
            },
        });
    }
}
async function executePiTaskTool(tool, params, ctx) {
    try {
        const result = await runWithService(tool, params, ctx);
        return successResult(result);
    }
    catch (error) {
        if (error instanceof PrivateListAccessError && ctx.hasUI) {
            const confirmed = await ctx.ui.confirm("Bypass private pi-tasks list?", [
                `Tool ${tool.name} needs access to private list ${error.list.id} (${error.list.name}).`,
                `Owner: ${error.list.owner_agent_id ?? "<none>"}`,
                `Created by: ${error.list.created_by_agent_id}`,
                `Current agent: ${error.actorAgentId}`,
                "Confirm only if the user explicitly wants this agent to bypass private-list protection.",
            ].join("\n"));
            if (confirmed) {
                const result = await runWithService(tool, params, ctx, {
                    reason: `User confirmed private-list bypass in Pi UI for ${tool.name}`,
                    toolName: tool.name,
                });
                return successResult({ private_access_bypassed: true, result });
            }
        }
        throw error;
    }
}
async function runWithService(tool, params, ctx, privateBypass) {
    const resolved = resolvePiAgentId(ctx.sessionManager);
    if (resolved.warning && ctx.hasUI)
        ctx.ui.notify(resolved.warning, "warning");
    const service = new TaskService({ cwd: ctx.cwd });
    try {
        return tool.run(service, params, { actor: { agentId: resolved.agentId, source: "pi" }, privateBypass }, ctx);
    }
    finally {
        service.close();
    }
}
function successResult(result) {
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
    };
}
export function errorResult(error) {
    const serialized = serializeError(error);
    return {
        content: [{ type: "text", text: JSON.stringify(serialized, null, 2) }],
        details: serialized,
    };
}
//# sourceMappingURL=tools.js.map