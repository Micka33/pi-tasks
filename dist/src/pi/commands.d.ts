import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskList, TaskListWithTasks } from "../core/types.js";
export declare function registerPiTaskCommands(pi: ExtensionAPI): void;
export declare function formatTaskListsCommandOutput(lists: TaskList[], options?: {
    full?: boolean;
}): string;
export declare function formatTasksCommandOutput(data: TaskListWithTasks, actorAgentId: string): string;
