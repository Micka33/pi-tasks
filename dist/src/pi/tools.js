import { Text } from "@earendil-works/pi-tui";
import { compactToolCallName, compactToolResultEnvelope, dispatchCompactTaskTool, formatCompactToolDisplay } from "../core/compact-tools.js";
import { PrivateListAccessError, serializeError } from "../core/errors.js";
import { resolvePiAgentId } from "../core/agent-id.js";
import { TaskService } from "../core/service.js";
import { TaskAuditParams, TaskClaimsParams, TaskHelpParams, TaskItemsParams, TaskListsParams } from "./schemas.js";
const COMPACT_TOOL_GUIDELINES = ["Call task_help for pi-tasks workflow rules, action schemas, and examples when needed."];
export function registerPiTaskTools(pi) {
    const tools = [
        {
            name: "task_lists",
            label: "Task Lists",
            description: "Manage pi-tasks lists with action=create|find|get|delete. Put action-specific fields in params; call task_help for schemas/examples.",
            promptSnippet: "Create, find, read, or delete pi-tasks lists.",
            parameters: TaskListsParams,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_lists", params, access),
        },
        {
            name: "task_items",
            label: "Task Items",
            description: "Manage tasks with action=create|add_many|update|reorder|delete. Put action-specific fields in params; call task_help for workflow rules.",
            promptSnippet: "Create, update, reorder, or delete tasks.",
            parameters: TaskItemsParams,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_items", params, access),
        },
        {
            name: "task_claims",
            label: "Task Claims",
            description: "Manage claims with action=claim_next|refresh|release_expired. Use claim_next to enter in_progress; call task_help for details.",
            promptSnippet: "Claim, refresh, or release expired task claims.",
            parameters: TaskClaimsParams,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_claims", params, access),
        },
        {
            name: "task_audit",
            label: "Task Audit",
            description: "Read private-list bypass audit events with action=get. Visibility rules are enforced; call task_help for params.",
            promptSnippet: "Read private-list bypass audit events visible to this agent.",
            parameters: TaskAuditParams,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_audit", params, access),
        },
        {
            name: "task_help",
            label: "Task Help",
            description: "Read pi-tasks workflow rules, compact action schemas, and examples. action defaults to all.",
            promptSnippet: "Get pi-tasks workflow, schemas, and examples.",
            parameters: TaskHelpParams,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_help", params, access),
        },
    ];
    for (const tool of tools) {
        pi.registerTool({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            promptSnippet: tool.promptSnippet,
            promptGuidelines: COMPACT_TOOL_GUIDELINES,
            parameters: tool.parameters,
            async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
                return executePiTaskTool(tool, params, ctx);
            },
            renderResult(result, options, _theme, context) {
                const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
                text.setText(options.expanded ? resultContentText(result.content) : formatCompactToolDisplay(result.details));
                return text;
            },
        });
    }
}
async function executePiTaskTool(tool, params, ctx) {
    try {
        const result = await runWithService(tool, params, ctx);
        return successResult(compactToolResultEnvelope(tool.name, params, result));
    }
    catch (error) {
        if (error instanceof PrivateListAccessError && ctx.hasUI) {
            const callName = compactToolCallName(tool.name, params);
            const confirmed = await ctx.ui.confirm("Bypass private pi-tasks list?", [
                `Tool ${callName} needs access to private list ${error.list.id} (${error.list.name}).`,
                `Owner: ${error.list.owner_agent_id ?? "<none>"}`,
                `Created by: ${error.list.created_by_agent_id}`,
                `Current agent: ${error.actorAgentId}`,
                "Confirm only if the user explicitly wants this agent to bypass private-list protection.",
            ].join("\n"));
            if (confirmed) {
                const result = await runWithService(tool, params, ctx, {
                    reason: `User confirmed private-list bypass in Pi UI for ${callName}`,
                    toolName: callName,
                });
                return successResult(compactToolResultEnvelope(tool.name, params, { private_access_bypassed: true, result }));
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
function resultContentText(content) {
    return content
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n");
}
export function errorResult(error) {
    const serialized = serializeError(error);
    return {
        content: [{ type: "text", text: JSON.stringify(serialized, null, 2) }],
        details: serialized,
    };
}
//# sourceMappingURL=tools.js.map