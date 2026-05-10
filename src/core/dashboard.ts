import type { AccessOptions, Task, TaskList, TaskStatus } from "./types.js";
import { TASK_STATUSES } from "./types.js";
import type { TaskService } from "./service.js";

export interface StatusCounts extends Record<TaskStatus, number> {}

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

export function buildDashboard(
  service: TaskService,
  access: AccessOptions,
  options: DashboardOptions = {},
): DashboardData {
  const lists = service.findTaskLists({}, access);
  const counts = emptyCounts();
  const myCounts = emptyCounts();
  const dashboardLists: DashboardList[] = [];
  const myTasks: DashboardTask[] = [];
  let totalActiveTasks = 0;

  for (const list of lists) {
    const listWithTasks = service.getTaskList({ list_id: list.id }, access);
    const tasks = options.includeDone
      ? listWithTasks.tasks
      : listWithTasks.tasks.filter((task) => task.status !== "done" && task.status !== "canceled");
    const listCounts = emptyCounts();
    const listMyTasks: DashboardTask[] = [];

    for (const task of tasks) {
      listCounts[task.status] += 1;
      counts[task.status] += 1;
      totalActiveTasks += 1;

      const assignedToAgent = task.assigned_to_agent_id === access.actor.agentId;
      const claimedByAgent = task.claimed_by_agent_id === access.actor.agentId;
      if (assignedToAgent || claimedByAgent) {
        const dashboardTask: DashboardTask = { task, list, assignedToAgent, claimedByAgent };
        listMyTasks.push(dashboardTask);
        myTasks.push(dashboardTask);
        myCounts[task.status] += 1;
      }
    }

    dashboardLists.push({
      list,
      counts: listCounts,
      totalActiveTasks: tasks.length,
      myTasks: listMyTasks,
      tasks,
    });
  }

  return {
    agentId: access.actor.agentId,
    lists: dashboardLists,
    counts,
    myCounts,
    myTasks,
    totalActiveTasks,
    generatedAt: new Date().toISOString(),
  };
}

export function emptyCounts(): StatusCounts {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as StatusCounts;
}
