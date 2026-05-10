import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { compactToolCallName, dispatchCompactTaskTool } from "../core/compact-tools.js";
import { PrivateListAccessError, serializeError } from "../core/errors.js";
import { resolveMcpAgentId } from "../core/agent-id.js";
import { TaskService } from "../core/service.js";
import { taskAuditSchema, taskClaimsSchema, taskHelpSchema, taskItemsSchema, taskListsSchema } from "./schemas.js";
export function registerMcpTaskTools(server) {
    const definitions = [
        {
            name: "task_lists",
            title: "Task Lists",
            description: "Manage pi-tasks lists with action=create|find|get|delete. Put action-specific fields in params; call task_help for schemas/examples.",
            inputSchema: taskListsSchema,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_lists", params, access),
        },
        {
            name: "task_items",
            title: "Task Items",
            description: "Manage tasks with action=create|add_many|update|reorder|delete. Put action-specific fields in params; call task_help for workflow rules.",
            inputSchema: taskItemsSchema,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_items", params, access),
        },
        {
            name: "task_claims",
            title: "Task Claims",
            description: "Manage claims with action=claim_next|refresh|release_expired. Use claim_next to enter in_progress; call task_help for details.",
            inputSchema: taskClaimsSchema,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_claims", params, access),
        },
        {
            name: "task_audit",
            title: "Task Audit",
            description: "Read private-list bypass audit events with action=get. Visibility rules are enforced; call task_help for params.",
            inputSchema: taskAuditSchema,
            readOnly: true,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_audit", params, access),
        },
        {
            name: "task_help",
            title: "Task Help",
            description: "Read pi-tasks workflow rules, compact action schemas, and examples. action defaults to all.",
            inputSchema: taskHelpSchema,
            readOnly: true,
            run: (service, params, access) => dispatchCompactTaskTool(service, "task_help", params, access),
        },
    ];
    for (const definition of definitions) {
        server.registerTool(definition.name, {
            title: definition.title,
            description: definition.description,
            inputSchema: definition.inputSchema,
            annotations: definition.readOnly ? { readOnlyHint: true } : undefined,
        }, async (params, extra) => executeMcpTaskTool(server, definition, params, extra));
    }
}
async function executeMcpTaskTool(server, definition, params, extra) {
    try {
        const result = await runWithService(definition, params, extra);
        return successResult(result);
    }
    catch (error) {
        if (error instanceof PrivateListAccessError) {
            const bypassed = await maybeElicitPrivateBypass(server, definition, params, error, extra);
            if (bypassed) {
                try {
                    const callName = compactToolCallName(definition.name, params);
                    const result = await runWithService(definition, params, extra, {
                        toolName: callName,
                        reason: `User confirmed private-list bypass via MCP elicitation for ${callName}`,
                    });
                    return successResult({ private_access_bypassed: true, result });
                }
                catch (retryError) {
                    return errorToolResult(retryError);
                }
            }
        }
        return errorToolResult(error);
    }
}
async function runWithService(definition, params, extra, privateBypass) {
    const actor = resolveMcpAgentId();
    const service = new TaskService();
    try {
        return definition.run(service, params, { actor: { agentId: actor.agentId, source: "mcp" }, privateBypass }, extra);
    }
    finally {
        service.close();
    }
}
async function maybeElicitPrivateBypass(server, definition, params, error, extra) {
    const clientCapabilities = server.server.getClientCapabilities();
    if (!clientCapabilities?.elicitation?.form)
        return false;
    const callName = compactToolCallName(definition.name, params);
    const response = await extra.sendRequest({
        method: "elicitation/create",
        params: {
            mode: "form",
            message: [
                `Tool ${callName} needs access to private pi-tasks list ${error.list.id} (${error.list.name}).`,
                `Owner: ${error.list.owner_agent_id ?? "<none>"}`,
                `Created by: ${error.list.created_by_agent_id}`,
                `Current MCP agent: ${error.actorAgentId}`,
                "Confirm only if you explicitly want this agent to bypass private-list protection.",
            ].join("\n"),
            requestedSchema: {
                type: "object",
                properties: {
                    confirm: {
                        type: "boolean",
                        title: "Bypass private-list protection",
                        description: "Allow this one tool call to access the private list.",
                        default: false,
                    },
                },
                required: ["confirm"],
            },
        },
    }, ElicitResultSchema);
    return response.action === "accept" && response.content?.confirm === true;
}
function successResult(data) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: { data: data },
    };
}
function errorToolResult(error) {
    const serialized = serializeError(error);
    return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(serialized, null, 2) }],
        structuredContent: { error: serialized },
    };
}
//# sourceMappingURL=tools.js.map