import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { piTasksMessages } from "../i18n/index.js";
import type { ActorContext } from "./types.js";

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export interface SessionLike {
  getSessionFile?: () => string | undefined;
}

export function resolvePiAgentId(sessionManager?: SessionLike): ActorContext & { warning?: string } {
  const override = process.env.PI_TASKS_AGENT_ID?.trim();
  if (override) return { agentId: override, source: "pi" };

  const sessionFile = sessionManager?.getSessionFile?.();
  if (sessionFile) {
    return { agentId: `pi-session:${shortHash(sessionFile)}`, source: "pi" };
  }

  return {
    agentId: `pi-ephemeral:${shortHash(`${hostname()}:${process.pid}:${Date.now()}`)}`,
    source: "pi",
    warning: piTasksMessages().agentId.piEphemeralWarning,
  };
}

export function resolveMcpAgentId(): ActorContext & { warning?: string } {
  const override = process.env.PI_TASKS_AGENT_ID?.trim();
  if (override) return { agentId: override, source: "mcp" };

  return {
    agentId: `mcp-process:${shortHash(`${hostname()}:${process.pid}`)}`,
    source: "mcp",
    warning: piTasksMessages().agentId.mcpProcessWarning,
  };
}
