import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { compactToolCallName, compactToolResultEnvelope, dispatchCompactTaskTool, formatCompactToolDisplay } from "../core/compact-tools.js";
import { PrivateListAccessError, serializeError } from "../core/errors.js";
import { resolvePiAgentId } from "../core/agent-id.js";
import { TaskService } from "../core/service.js";
import type { AccessOptions } from "../core/types.js";
import { piTasksMessages } from "../i18n/index.js";
import { TaskAuditParams, TaskClaimsParams, TaskHelpParams, TaskItemsParams, TaskListsParams } from "./schemas.js";

type RunTool = (service: TaskService, params: unknown, access: AccessOptions, ctx: ExtensionContext) => unknown;

interface TaskToolDefinition {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  parameters: TSchema;
  run: RunTool;
}

export function registerPiTaskTools(pi: ExtensionAPI): void {
  const ui = piTasksMessages().piTools;
  const tools: TaskToolDefinition[] = [
    {
      name: "task_lists",
      ...ui.definitions.task_lists,
      parameters: TaskListsParams,
      run: (service, params, access) => dispatchCompactTaskTool(service, "task_lists", params, access),
    },
    {
      name: "task_items",
      ...ui.definitions.task_items,
      parameters: TaskItemsParams,
      run: (service, params, access) => dispatchCompactTaskTool(service, "task_items", params, access),
    },
    {
      name: "task_claims",
      ...ui.definitions.task_claims,
      parameters: TaskClaimsParams,
      run: (service, params, access) => dispatchCompactTaskTool(service, "task_claims", params, access),
    },
    {
      name: "task_audit",
      ...ui.definitions.task_audit,
      parameters: TaskAuditParams,
      run: (service, params, access) => dispatchCompactTaskTool(service, "task_audit", params, access),
    },
    {
      name: "task_help",
      ...ui.definitions.task_help,
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
      promptGuidelines: ui.compactGuidelines,
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

async function executePiTaskTool(tool: TaskToolDefinition, params: unknown, ctx: ExtensionContext) {
  try {
    const result = await runWithService(tool, params, ctx);
    return successResult(compactToolResultEnvelope(tool.name, params, result));
  } catch (error) {
    if (error instanceof PrivateListAccessError && ctx.hasUI) {
      const callName = compactToolCallName(tool.name, params);
      const bypass = piTasksMessages().piTools.bypass;
      const confirmed = await ctx.ui.confirm(
        bypass.title,
        [
          `${bypass.toolSubject} ${callName} ${bypass.toolAccess} ${error.list.id} (${error.list.name}).`,
          `${bypass.owner}: ${error.list.owner_agent_id ?? bypass.none}`,
          `${bypass.createdBy}: ${error.list.created_by_agent_id}`,
          `${bypass.currentAgent}: ${error.actorAgentId}`,
          bypass.confirmTool,
        ].join("\n"),
      );

      if (confirmed) {
        const result = await runWithService(tool, params, ctx, {
          reason: `${bypass.reasonPrefix} ${callName}`,
          toolName: callName,
        });
        return successResult(compactToolResultEnvelope(tool.name, params, { private_access_bypassed: true, result }));
      }
    }

    throw error;
  }
}

async function runWithService(
  tool: TaskToolDefinition,
  params: unknown,
  ctx: ExtensionContext,
  privateBypass?: AccessOptions["privateBypass"],
): Promise<unknown> {
  const resolved = resolvePiAgentId(ctx.sessionManager);
  if (resolved.warning && ctx.hasUI) ctx.ui.notify(resolved.warning, "warning");

  const service = new TaskService({ cwd: ctx.cwd });
  try {
    return tool.run(service, params, { actor: { agentId: resolved.agentId, source: "pi" }, privateBypass }, ctx);
  } finally {
    service.close();
  }
}

function successResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}

function resultContentText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

export function errorResult(error: unknown) {
  const serialized = serializeError(error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(serialized, null, 2) }],
    details: serialized,
  };
}
