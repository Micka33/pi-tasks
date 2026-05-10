import type { TaskList } from "./types.js";
export declare class PiTasksError extends Error {
    readonly code: string;
    readonly details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare class NotFoundError extends PiTasksError {
    constructor(entity: string, id: string);
}
export declare class ValidationError extends PiTasksError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class PrivateListAccessError extends PiTasksError {
    readonly list: TaskList;
    readonly actorAgentId: string;
    readonly toolName?: string | undefined;
    constructor(list: TaskList, actorAgentId: string, toolName?: string | undefined);
}
export declare class ClaimConflictError extends PiTasksError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare function serializeError(error: unknown): Record<string, unknown>;
