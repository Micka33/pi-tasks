import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { TASK_AUDIT_ACTIONS, TASK_CLAIM_ACTIONS, TASK_HELP_ACTIONS, TASK_ITEM_ACTIONS, TASK_LIST_ACTIONS } from "../core/compact-tools.js";
import { piTasksMessages } from "../i18n/index.js";

const ActionParams = Type.Optional(Type.Any({ description: piTasksMessages().schema.actionParamsDescription }));

export const TaskListsParams = Type.Object({
  action: StringEnum(TASK_LIST_ACTIONS),
  params: ActionParams,
});

export const TaskItemsParams = Type.Object({
  action: StringEnum(TASK_ITEM_ACTIONS),
  params: ActionParams,
});

export const TaskClaimsParams = Type.Object({
  action: StringEnum(TASK_CLAIM_ACTIONS),
  params: ActionParams,
});

export const TaskAuditParams = Type.Object({
  action: StringEnum(TASK_AUDIT_ACTIONS),
  params: ActionParams,
});

export const TaskHelpParams = Type.Object({
  action: Type.Optional(StringEnum(TASK_HELP_ACTIONS)),
});
