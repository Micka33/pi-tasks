import { resolvePiAgentId } from "../core/agent-id.js";
import { PrivateListAccessError } from "../core/errors.js";
import { TaskService } from "../core/service.js";
export function registerPiTaskCommands(pi) {
    pi.registerCommand("task-store", {
        description: "Show the SQLite database path used by pi-tasks",
        handler: async (_args, ctx) => {
            const { service, access, warning } = openForCommand(ctx);
            try {
                if (warning)
                    ctx.ui.notify(warning, "warning");
                ctx.ui.notify(JSON.stringify(service.getAgentSummary(access.actor), null, 2), "info");
            }
            finally {
                service.close();
            }
        },
    });
    pi.registerCommand("task-agent", {
        description: "Show the current pi-tasks agent id derived from the Pi session",
        handler: async (_args, ctx) => {
            const resolved = resolvePiAgentId(ctx.sessionManager);
            if (resolved.warning)
                ctx.ui.notify(resolved.warning, "warning");
            ctx.ui.notify(resolved.agentId, "info");
        },
    });
    pi.registerCommand("task-lists", {
        description: "Show task lists visible to this Pi session",
        handler: async (_args, ctx) => {
            const { service, access, warning } = openForCommand(ctx);
            try {
                if (warning)
                    ctx.ui.notify(warning, "warning");
                const lists = service.findTaskLists({}, access);
                ctx.ui.notify(JSON.stringify(lists, null, 2), "info");
            }
            finally {
                service.close();
            }
        },
    });
    pi.registerCommand("tasks", {
        description: "Show one task list: /tasks <list_id>",
        handler: async (args, ctx) => {
            const listId = args.trim();
            if (!listId) {
                ctx.ui.notify("Usage: /tasks <list_id>", "error");
                return;
            }
            const result = await withOptionalBypass(ctx, "tasks", (service, access) => service.getTaskList({ list_id: listId }, access));
            ctx.ui.notify(JSON.stringify(result, null, 2), "info");
        },
    });
}
function openForCommand(ctx) {
    const resolved = resolvePiAgentId(ctx.sessionManager);
    const service = new TaskService({ cwd: ctx.cwd });
    return {
        service,
        access: { actor: { agentId: resolved.agentId, source: "pi" } },
        warning: resolved.warning,
    };
}
async function withOptionalBypass(ctx, commandName, fn) {
    const opened = openForCommand(ctx);
    try {
        try {
            return fn(opened.service, opened.access);
        }
        catch (error) {
            if (!(error instanceof PrivateListAccessError) || !ctx.hasUI)
                throw error;
            const confirmed = await ctx.ui.confirm("Bypass private pi-tasks list?", [
                `Command /${commandName} needs access to private list ${error.list.id} (${error.list.name}).`,
                `Owner: ${error.list.owner_agent_id ?? "<none>"}`,
                `Created by: ${error.list.created_by_agent_id}`,
                `Current agent: ${error.actorAgentId}`,
            ].join("\n"));
            if (!confirmed)
                throw error;
            return fn(opened.service, {
                ...opened.access,
                privateBypass: {
                    toolName: `/${commandName}`,
                    reason: `User confirmed private-list bypass in Pi command /${commandName}`,
                },
            });
        }
    }
    finally {
        opened.service.close();
    }
}
//# sourceMappingURL=commands.js.map