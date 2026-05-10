import type { ActorContext } from "./types.js";
export declare function shortHash(value: string): string;
export interface SessionLike {
    getSessionFile?: () => string | undefined;
}
export declare function resolvePiAgentId(sessionManager?: SessionLike): ActorContext & {
    warning?: string;
};
export declare function resolveMcpAgentId(): ActorContext & {
    warning?: string;
};
