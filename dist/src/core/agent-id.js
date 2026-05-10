import { createHash } from "node:crypto";
import { hostname } from "node:os";
export function shortHash(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
export function resolvePiAgentId(sessionManager) {
    const override = process.env.PI_TASKS_AGENT_ID?.trim();
    if (override)
        return { agentId: override, source: "pi" };
    const sessionFile = sessionManager?.getSessionFile?.();
    if (sessionFile) {
        return { agentId: `pi-session:${shortHash(sessionFile)}`, source: "pi" };
    }
    return {
        agentId: `pi-ephemeral:${shortHash(`${hostname()}:${process.pid}:${Date.now()}`)}`,
        source: "pi",
        warning: "Pi session file unavailable; using an ephemeral agent id. Use a persisted Pi session or PI_TASKS_AGENT_ID for stable ownership.",
    };
}
export function resolveMcpAgentId() {
    const override = process.env.PI_TASKS_AGENT_ID?.trim();
    if (override)
        return { agentId: override, source: "mcp" };
    return {
        agentId: `mcp-process:${shortHash(`${hostname()}:${process.pid}`)}`,
        source: "mcp",
        warning: "PI_TASKS_AGENT_ID is not set; using a process-scoped MCP agent id. Set PI_TASKS_AGENT_ID for stable claims and private-list ownership.",
    };
}
//# sourceMappingURL=agent-id.js.map