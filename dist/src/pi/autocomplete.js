import { resolvePiAgentId } from "../core/agent-id.js";
import { TaskService } from "../core/service.js";
const MAX_LIST_ID_SUGGESTIONS = 20;
export function registerPiTaskAutocomplete(pi) {
    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI)
            return;
        ctx.ui.addAutocompleteProvider((current) => createTaskListIdAutocompleteProvider(current, ctx));
    });
}
export function createTaskListIdAutocompleteProvider(current, ctx) {
    return {
        async getSuggestions(lines, cursorLine, cursorCol, options) {
            const line = lines[cursorLine] ?? "";
            const beforeCursor = line.slice(0, cursorCol);
            const prefix = extractTasksListIdPrefix(beforeCursor);
            if (prefix === undefined)
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
            const suggestions = loadTaskListIdSuggestions(ctx, prefix);
            if (options.signal.aborted || suggestions.length === 0)
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
            return { prefix, items: suggestions };
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
            return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },
        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
            const line = lines[cursorLine] ?? "";
            const beforeCursor = line.slice(0, cursorCol);
            if (extractTasksListIdPrefix(beforeCursor) !== undefined)
                return false;
            return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
    };
}
export function extractTasksListIdPrefix(beforeCursor) {
    const match = beforeCursor.match(/^\/(?:tasks|task-list-delete|task-audit)[ \t]+([^ \t]*)$/);
    return match?.[1];
}
export function taskListsToAutocompleteItems(lists, prefix) {
    const query = prefix.trim().toLowerCase();
    const scored = lists
        .map((list, index) => ({ list, index, score: scoreListMatch(list, query) }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, MAX_LIST_ID_SUGGESTIONS);
    return scored.map(({ list }) => ({
        value: list.id,
        label: list.id,
        description: `${list.name} · ${list.visibility} · ${list.scope_type}`,
    }));
}
function loadTaskListIdSuggestions(ctx, prefix) {
    const resolved = resolvePiAgentId(ctx.sessionManager);
    const service = new TaskService({ cwd: ctx.cwd });
    try {
        const access = { actor: { agentId: resolved.agentId, source: "pi" } };
        return taskListsToAutocompleteItems(service.findTaskLists({}, access), prefix);
    }
    catch {
        return [];
    }
    finally {
        service.close();
    }
}
function scoreListMatch(list, query) {
    if (!query)
        return 1;
    const id = list.id.toLowerCase();
    const name = list.name.toLowerCase();
    if (id === query)
        return 100;
    if (id.startsWith(query))
        return 90;
    if (name.startsWith(query))
        return 80;
    if (id.includes(query))
        return 70;
    if (name.includes(query))
        return 60;
    return -1;
}
//# sourceMappingURL=autocomplete.js.map