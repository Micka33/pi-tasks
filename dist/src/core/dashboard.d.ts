import type { AccessOptions, Task, TaskList, TaskStatus } from "./types.js";
import type { TaskService } from "./service.js";
export interface StatusCounts extends Record<TaskStatus, number> {
}
export interface DashboardTask {
    task: Task;
    list: TaskList;
    assignedToAgent: boolean;
    claimedByAgent: boolean;
}
export interface DashboardList {
    list: TaskList;
    counts: StatusCounts;
    totalActiveTasks: number;
    myTasks: DashboardTask[];
    tasks: Task[];
}
export interface DashboardData {
    agentId: string;
    lists: DashboardList[];
    counts: StatusCounts;
    myCounts: StatusCounts;
    myTasks: DashboardTask[];
    totalActiveTasks: number;
    generatedAt: string;
}
export interface DashboardOptions {
    includeDone?: boolean;
}
export declare function buildDashboard(service: TaskService, access: AccessOptions, options?: DashboardOptions): DashboardData;
export declare function emptyCounts(): StatusCounts;
