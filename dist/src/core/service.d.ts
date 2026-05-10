import { type AccessOptions, type ActorContext, type AddManyTasksInput, type ClaimNextTaskInput, type ClaimResult, type CreateTaskInput, type CreateTaskListInput, type DeleteTaskInput, type DeleteTaskListInput, type DeleteTaskListResult, type FindTaskListsInput, type GetTaskListInput, type PrivateAccessEvent, type PrivateAccessEventsGetInput, type RefreshClaimInput, type ReleaseExpiredClaimsInput, type ReleaseExpiredClaimsResult, type ReorderTasksInput, type Task, type TaskList, type TaskListWithTasks, type UpdateTaskInput } from "./types.js";
interface TaskServiceOptions {
    dbPath?: string;
    cwd?: string;
    now?: () => Date;
}
export declare class TaskService {
    readonly dbPath: string;
    private readonly db;
    private readonly nowFn;
    constructor(options?: TaskServiceOptions);
    close(): void;
    getAgentSummary(actor: ActorContext): {
        db_path: string;
        agent_id: string;
        source: string;
    };
    createTaskList(input: CreateTaskListInput, access: AccessOptions): TaskList;
    findTaskLists(input: FindTaskListsInput, access: AccessOptions): TaskList[];
    getTaskList(input: GetTaskListInput, access: AccessOptions): TaskListWithTasks;
    createTask(input: CreateTaskInput, access: AccessOptions): Task;
    addManyTasks(input: AddManyTasksInput, access: AccessOptions): Task[];
    claimNextTask(input: ClaimNextTaskInput, access: AccessOptions): ClaimResult;
    refreshClaim(input: RefreshClaimInput, access: AccessOptions): Task;
    updateTask(input: UpdateTaskInput, access: AccessOptions): Task;
    reorderTasks(input: ReorderTasksInput, access: AccessOptions): Task[];
    releaseExpiredClaims(input: ReleaseExpiredClaimsInput, access: AccessOptions): ReleaseExpiredClaimsResult;
    deleteTaskList(input: DeleteTaskListInput, access: AccessOptions): DeleteTaskListResult;
    deleteTask(input: DeleteTaskInput, access: AccessOptions): Task;
    getPrivateAccessEvents(input: PrivateAccessEventsGetInput, access: AccessOptions): PrivateAccessEvent[];
    private releaseExpiredClaimsInternal;
    private getTaskListForAccess;
    private getTaskListRow;
    private getTaskRow;
    private getTasksForList;
    private nextPosition;
    private maxActivePosition;
    private canAccessList;
    private assertListAccess;
    private logPrivateAccess;
    private nowIso;
    private addSecondsIso;
}
export {};
