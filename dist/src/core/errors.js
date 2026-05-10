export class PiTasksError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "PiTasksError";
    }
}
export class NotFoundError extends PiTasksError {
    constructor(entity, id) {
        super("NOT_FOUND", `${entity} not found: ${id}`, { entity, id });
        this.name = "NotFoundError";
    }
}
export class ValidationError extends PiTasksError {
    constructor(message, details = {}) {
        super("VALIDATION_ERROR", message, details);
        this.name = "ValidationError";
    }
}
export class PrivateListAccessError extends PiTasksError {
    list;
    actorAgentId;
    toolName;
    constructor(list, actorAgentId, toolName) {
        super("PRIVATE_LIST_ACCESS_DENIED", `Access denied to private task list ${list.id}`, {
            list_id: list.id,
            list_name: list.name,
            owner_agent_id: list.owner_agent_id,
            created_by_agent_id: list.created_by_agent_id,
            actor_agent_id: actorAgentId,
            tool_name: toolName,
        });
        this.list = list;
        this.actorAgentId = actorAgentId;
        this.toolName = toolName;
        this.name = "PrivateListAccessError";
    }
}
export class ClaimConflictError extends PiTasksError {
    constructor(message, details = {}) {
        super("CLAIM_CONFLICT", message, details);
        this.name = "ClaimConflictError";
    }
}
export function serializeError(error) {
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
//# sourceMappingURL=errors.js.map