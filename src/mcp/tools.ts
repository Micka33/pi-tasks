import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { PrivateListAccessError, serializeError } from "../core/errors.js";
import { resolveMcpAgentId } from "../core/agent-id.js";
import { TaskService } from "../core/service.js";
import type { AccessOptions } from "../core/types.js";
import {
  privateAccessEventsGetSchema,
  taskAddManySchema,
  taskClaimNextSchema,
  taskClaimRefreshSchema,
  taskCreateSchema,
  taskDeleteSchema,
  taskListCreateSchema,
  taskListDeleteSchema,
  taskListGetSchema,
  taskListsFindSchema,
  taskReleaseExpiredClaimsSchema,
  taskReorderSchema,
  taskUpdateSchema,
} from "./schemas.js";

const COMMON_DESCRIPTION_SUFFIX =
  " Private task lists are strictly enforced. Use task_claim_next as the only normal way to enter in_progress; task_update rejects status=in_progress. Use task_claim_refresh for long-running claims. Use notes as task-local working memory for important context, choices in progress, blockers, and next steps. When closing a task as done/canceled, outcome is required and should summarize choices/decisions, actions taken, and final state obtained. When pausing with status=blocked, omit assigned_to_agent_id to keep responsibility on the pausing agent; pass assigned_to_agent_id:null to release it.";

type McpExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type RunTool = (service: TaskService, params: any, access: AccessOptions, extra: McpExtra) => unknown;

interface McpTaskToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: any;
  readOnly?: boolean;
  run: RunTool;
}

export function registerMcpTaskTools(server: McpServer): void {
  const definitions: McpTaskToolDefinition[] = [
    {
      name: "task_list_create",
      title: "Create Task List",
      description: "Create a persistent task list. The MCP agent becomes created_by_agent_id; private lists default to the MCP agent as owner." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskListCreateSchema,
      run: (service, params, access) => service.createTaskList(params, access),
    },
    {
      name: "task_lists_find",
      title: "Find Task Lists",
      description: "Find task lists by scope, visibility, owner, creator, or name. Inaccessible private lists are hidden unless include_inaccessible_private is requested and a bypass is confirmed." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskListsFindSchema,
      readOnly: true,
      run: (service, params, access) => service.findTaskLists(params, access),
    },
    {
      name: "task_list_get",
      title: "Get Task List",
      description: "Read a task list and its tasks in execution order. Deleted tasks are hidden unless include_deleted is true." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskListGetSchema,
      readOnly: true,
      run: (service, params, access) => service.getTaskList(params, access),
    },
    {
      name: "task_list_delete",
      title: "Delete Task List",
      description: "Soft-delete a task list and all active tasks in it by setting deleted_at. Claims are cleared; rows remain in SQLite for audit/history." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskListDeleteSchema,
      run: (service, params, access) => service.deleteTaskList(params, access),
    },
    {
      name: "task_private_access_events_get",
      title: "Get Private Access Audit Events",
      description: "Read audited private-list bypass events. With list_id, the current agent must have access to that list or explicitly confirm a private-list bypass. Without list_id, only events for visible lists are returned." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: privateAccessEventsGetSchema,
      readOnly: true,
      run: (service, params, access) => service.getPrivateAccessEvents(params, access),
    },
    {
      name: "task_create",
      title: "Create Task",
      description: "Add a single todo task to a task list, optionally at a specific 1-based position." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskCreateSchema,
      run: (service, params, access) => service.createTask(params, access),
    },
    {
      name: "task_add_many",
      title: "Add Many Tasks",
      description: "Add multiple todo tasks to a task list in one transaction." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskAddManySchema,
      run: (service, params, access) => service.addManyTasks(params, access),
    },
    {
      name: "task_claim_next",
      title: "Claim Next Task",
      description: "Atomically claim the next todo task for the current MCP agent. This is the only normal way to move a task to in_progress." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskClaimNextSchema,
      run: (service, params, access) => service.claimNextTask(params, access),
    },
    {
      name: "task_claim_refresh",
      title: "Refresh Task Claim",
      description: "Refresh the current MCP agent's claim on an in_progress task. Updates claim_expires_at without changing started_at." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskClaimRefreshSchema,
      run: (service, params, access) => service.refreshClaim(params, access),
    },
    {
      name: "task_update",
      title: "Update Task",
      description: "Update task fields, notes, outcome, or status. Notes are task-local working memory. Setting status to in_progress is rejected; use task_claim_next instead. Closing a task as done/canceled requires outcome with choices/decisions, actions taken, and final state obtained. Setting status to blocked keeps assignment on the pausing agent unless assigned_to_agent_id:null is passed." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskUpdateSchema,
      run: (service, params, access) => service.updateTask(params, access),
    },
    {
      name: "task_reorder",
      title: "Reorder Tasks",
      description: "Reorder active tasks in a list. Provided task_ids are placed first; omitted active tasks keep relative order after them." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskReorderSchema,
      run: (service, params, access) => service.reorderTasks(params, access),
    },
    {
      name: "task_release_expired_claims",
      title: "Release Expired Claims",
      description: "Release expired in_progress claims back to todo without clearing started_at." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskReleaseExpiredClaimsSchema,
      run: (service, params, access) => service.releaseExpiredClaims(params, access),
    },
    {
      name: "task_delete",
      title: "Delete Task",
      description: "Soft-delete a task by setting deleted_at. The row remains in SQLite for audit/history." + COMMON_DESCRIPTION_SUFFIX,
      inputSchema: taskDeleteSchema,
      run: (service, params, access) => service.deleteTask(params, access),
    },
  ];

  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.readOnly ? { readOnlyHint: true } : undefined,
      },
      async (params: unknown, extra: McpExtra) => executeMcpTaskTool(server, definition, params, extra),
    );
  }
}

async function executeMcpTaskTool(
  server: McpServer,
  definition: McpTaskToolDefinition,
  params: unknown,
  extra: McpExtra,
): Promise<CallToolResult> {
  try {
    const result = await runWithService(definition, params, extra);
    return successResult(result);
  } catch (error) {
    if (error instanceof PrivateListAccessError) {
      const bypassed = await maybeElicitPrivateBypass(server, definition, error, extra);
      if (bypassed) {
        try {
          const result = await runWithService(definition, params, extra, {
            toolName: definition.name,
            reason: `User confirmed private-list bypass via MCP elicitation for ${definition.name}`,
          });
          return successResult({ private_access_bypassed: true, result });
        } catch (retryError) {
          return errorToolResult(retryError);
        }
      }
    }
    return errorToolResult(error);
  }
}

async function runWithService(
  definition: McpTaskToolDefinition,
  params: unknown,
  extra: McpExtra,
  privateBypass?: AccessOptions["privateBypass"],
): Promise<unknown> {
  const actor = resolveMcpAgentId();
  const service = new TaskService();
  try {
    return definition.run(service, params, { actor: { agentId: actor.agentId, source: "mcp" }, privateBypass }, extra);
  } finally {
    service.close();
  }
}

async function maybeElicitPrivateBypass(
  server: McpServer,
  definition: McpTaskToolDefinition,
  error: PrivateListAccessError,
  extra: McpExtra,
): Promise<boolean> {
  const clientCapabilities = server.server.getClientCapabilities();
  if (!clientCapabilities?.elicitation?.form) return false;

  const response = await extra.sendRequest(
    {
      method: "elicitation/create",
      params: {
        mode: "form",
        message: [
          `Tool ${definition.name} needs access to private pi-tasks list ${error.list.id} (${error.list.name}).`,
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
    } as ServerRequest,
    ElicitResultSchema,
  );

  return response.action === "accept" && response.content?.confirm === true;
}

function successResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: { data: data as Record<string, unknown> },
  };
}

function errorToolResult(error: unknown): CallToolResult {
  const serialized = serializeError(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(serialized, null, 2) }],
    structuredContent: { error: serialized },
  };
}
