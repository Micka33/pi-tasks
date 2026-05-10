import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { TaskList } from "../core/types.js";
export declare function registerPiTaskAutocomplete(pi: ExtensionAPI): void;
export declare function createTaskListIdAutocompleteProvider(current: AutocompleteProvider, ctx: ExtensionContext): AutocompleteProvider;
export declare function extractTasksListIdPrefix(beforeCursor: string): string | undefined;
export declare function taskListsToAutocompleteItems(lists: TaskList[], prefix: string): AutocompleteItem[];
