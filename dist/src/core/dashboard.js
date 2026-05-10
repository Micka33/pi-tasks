import { TASK_STATUSES } from "./types.js";
export function buildDashboard(service, access, options = {}) {
    const lists = service.findTaskLists({}, access);
    const counts = emptyCounts();
    const myCounts = emptyCounts();
    const dashboardLists = [];
    const myTasks = [];
    let totalActiveTasks = 0;
    for (const list of lists) {
        const listWithTasks = service.getTaskList({ list_id: list.id }, access);
        const tasks = options.includeDone
            ? listWithTasks.tasks
            : listWithTasks.tasks.filter((task) => task.status !== "done" && task.status !== "canceled");
        const listCounts = emptyCounts();
        const listMyTasks = [];
        for (const task of tasks) {
            listCounts[task.status] += 1;
            counts[task.status] += 1;
            totalActiveTasks += 1;
            const assignedToAgent = task.assigned_to_agent_id === access.actor.agentId;
            const claimedByAgent = task.claimed_by_agent_id === access.actor.agentId;
            if (assignedToAgent || claimedByAgent) {
                const dashboardTask = { task, list, assignedToAgent, claimedByAgent };
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
export function emptyCounts() {
    return Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
}
//# sourceMappingURL=dashboard.js.map