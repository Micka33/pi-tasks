export declare const SCOPE_TYPES: readonly ["workspace", "thread", "agent", "global", "custom"];
export type ScopeType = (typeof SCOPE_TYPES)[number];
export declare const VISIBILITIES: readonly ["private", "shared"];
export type Visibility = (typeof VISIBILITIES)[number];
export declare const TASK_STATUSES: readonly ["todo", "in_progress", "blocked", "done", "canceled"];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export declare const DEFAULT_CLAIM_TTL_SECONDS: number;
export interface TaskList {
    id: string;
    name: string;
    scope_type: ScopeType;
    scope_key: string;
    visibility: Visibility;
    owner_agent_id: string | null;
    created_by_agent_id: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}
export interface Task {
    id: string;
    list_id: string;
    position: number;
    title: string;
    description: string | null;
    notes: string | null;
    status: TaskStatus;
    assigned_to_agent_id: string | null;
    claimed_by_agent_id: string | null;
    claim_expires_at: string | null;
    outcome: string | null;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
    deleted_at: string | null;
}
export interface PrivateAccessEvent {
    id: string;
    list_id: string;
    actor_agent_id: string;
    tool_name: string;
    reason: string;
    created_at: string;
}
export interface ActorContext {
    agentId: string;
    source: "pi" | "mcp" | "test" | "unknown";
}
export interface PrivateBypass {
    reason: string;
    toolName: string;
}
export interface AccessOptions {
    actor: ActorContext;
    privateBypass?: PrivateBypass;
}
export interface CreateTaskListInput {
    id?: string;
    name: string;
    scope_type: ScopeType;
    scope_key: string;
    visibility?: Visibility;
    owner_agent_id?: string | null;
}
export interface FindTaskListsInput {
    scope_type?: ScopeType;
    scope_key?: string;
    visibility?: Visibility;
    owner_agent_id?: string | null;
    created_by_agent_id?: string;
    name?: string;
    include_deleted?: boolean;
    include_inaccessible_private?: boolean;
}
export interface GetTaskListInput {
    list_id: string;
    statuses?: TaskStatus[];
    include_deleted?: boolean;
}
export interface CreateTaskInput {
    id?: string;
    list_id: string;
    title: string;
    description?: string | null;
    notes?: string | null;
    position?: number;
    assigned_to_agent_id?: string | null;
}
export interface AddManyTasksInput {
    list_id: string;
    tasks: Array<{
        id?: string;
        title: string;
        description?: string | null;
        notes?: string | null;
        assigned_to_agent_id?: string | null;
    }>;
}
export interface ClaimNextTaskInput {
    list_id: string;
    claim_ttl_seconds?: number;
    release_expired_first?: boolean;
}
export interface RefreshClaimInput {
    task_id: string;
    claim_ttl_seconds?: number;
}
export interface UpdateTaskInput {
    task_id: string;
    title?: string;
    description?: string | null;
    notes?: string | null;
    status?: TaskStatus;
    assigned_to_agent_id?: string | null;
    outcome?: string | null;
}
export interface ReorderTasksInput {
    list_id: string;
    task_ids: string[];
}
export interface ReleaseExpiredClaimsInput {
    list_id?: string;
}
export interface DeleteTaskInput {
    task_id: string;
}
export interface TaskListWithTasks {
    list: TaskList;
    tasks: Task[];
}
export interface ClaimResult {
    task: Task | null;
}
export interface ReleaseExpiredClaimsResult {
    released: Task[];
}
