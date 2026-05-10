import { z } from "zod/v4";
import { TASK_AUDIT_ACTIONS, TASK_CLAIM_ACTIONS, TASK_HELP_ACTIONS, TASK_ITEM_ACTIONS, TASK_LIST_ACTIONS } from "../core/compact-tools.js";
const ActionParams = z.record(z.string(), z.unknown()).optional().describe("Action-specific object. Use task_help for exact schemas and examples.");
export const taskListsSchema = z.object({
    action: z.enum(TASK_LIST_ACTIONS),
    params: ActionParams,
});
export const taskItemsSchema = z.object({
    action: z.enum(TASK_ITEM_ACTIONS),
    params: ActionParams,
});
export const taskClaimsSchema = z.object({
    action: z.enum(TASK_CLAIM_ACTIONS),
    params: ActionParams,
});
export const taskAuditSchema = z.object({
    action: z.enum(TASK_AUDIT_ACTIONS),
    params: ActionParams,
});
export const taskHelpSchema = z.object({
    action: z.enum(TASK_HELP_ACTIONS).optional(),
});
//# sourceMappingURL=schemas.js.map