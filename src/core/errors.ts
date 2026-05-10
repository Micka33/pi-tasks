import type { TaskList } from "./types.js";

export class PiTasksError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PiTasksError";
  }
}

export class NotFoundError extends PiTasksError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} not found: ${id}`, { entity, id });
    this.name = "NotFoundError";
  }
}

export class ValidationError extends PiTasksError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class PrivateListAccessError extends PiTasksError {
  constructor(
    public readonly list: TaskList,
    public readonly actorAgentId: string,
    public readonly toolName?: string,
  ) {
    super(
      "PRIVATE_LIST_ACCESS_DENIED",
      `Access denied to private task list ${list.id}`,
      {
        list_id: list.id,
        list_name: list.name,
        owner_agent_id: list.owner_agent_id,
        created_by_agent_id: list.created_by_agent_id,
        actor_agent_id: actorAgentId,
        tool_name: toolName,
      },
    );
    this.name = "PrivateListAccessError";
  }
}

export class ClaimConflictError extends PiTasksError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("CLAIM_CONFLICT", message, details);
    this.name = "ClaimConflictError";
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof PiTasksError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
