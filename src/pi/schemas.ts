import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { SCOPE_TYPES, TASK_STATUSES, VISIBILITIES } from "../core/types.js";

const ScopeType = StringEnum(SCOPE_TYPES);
const Visibility = StringEnum(VISIBILITIES);
const TaskStatus = StringEnum(TASK_STATUSES);

const OptionalNullableString = Type.Optional(Type.Union([Type.String(), Type.Null()]));
const TaskNotes = Type.Optional(
  Type.Union([Type.String(), Type.Null()], {
    description: "Ongoing working notes for agents. Use as task-local memory for important context, choices in progress, blockers, and next steps.",
  }),
);
const TaskUpdateAssignedToAgentId = Type.Optional(
  Type.Union([Type.String(), Type.Null()], {
    description: "Set an assignee. When status=blocked, omit to assign the paused task to the current agent; pass null to release it.",
  }),
);
const TaskOutcome = Type.Optional(
  Type.Union([Type.String(), Type.Null()], {
    description: "Required when closing a task as done/canceled. Summarize choices/decisions, actions taken, and the final state obtained.",
  }),
);

export const TaskListCreateParams = Type.Object({
  id: Type.Optional(Type.String({ description: "Optional stable list id. Generated when omitted." })),
  name: Type.String({ description: "Human-readable task list name." }),
  scope_type: ScopeType,
  scope_key: Type.String({ description: "Workspace path, thread id, agent id, or custom key." }),
  visibility: Type.Optional(Visibility),
  owner_agent_id: OptionalNullableString,
});

export const TaskListsFindParams = Type.Object({
  scope_type: Type.Optional(ScopeType),
  scope_key: Type.Optional(Type.String()),
  visibility: Type.Optional(Visibility),
  owner_agent_id: OptionalNullableString,
  created_by_agent_id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String({ description: "Case-insensitive substring match." })),
  include_deleted: Type.Optional(Type.Boolean()),
  include_inaccessible_private: Type.Optional(
    Type.Boolean({ description: "Requires explicit user confirmation before private lists owned by others are returned." }),
  ),
});

export const TaskListGetParams = Type.Object({
  list_id: Type.String(),
  statuses: Type.Optional(Type.Array(TaskStatus)),
  include_deleted: Type.Optional(Type.Boolean()),
});

export const TaskCreateParams = Type.Object({
  id: Type.Optional(Type.String()),
  list_id: Type.String(),
  title: Type.String(),
  description: OptionalNullableString,
  notes: TaskNotes,
  position: Type.Optional(Type.Number({ description: "1-based desired position. Existing tasks are shifted down." })),
  assigned_to_agent_id: OptionalNullableString,
});

export const TaskAddManyParams = Type.Object({
  list_id: Type.String(),
  tasks: Type.Array(
    Type.Object({
      id: Type.Optional(Type.String()),
      title: Type.String(),
      description: OptionalNullableString,
      notes: TaskNotes,
      assigned_to_agent_id: OptionalNullableString,
    }),
  ),
});

export const TaskClaimNextParams = Type.Object({
  list_id: Type.String(),
  claim_ttl_seconds: Type.Optional(Type.Number({ description: "Claim TTL in seconds. Defaults to 7200 (2h)." })),
  release_expired_first: Type.Optional(Type.Boolean({ description: "Defaults to true." })),
});

export const TaskClaimRefreshParams = Type.Object({
  task_id: Type.String(),
  claim_ttl_seconds: Type.Optional(Type.Number({ description: "New TTL from now in seconds. Defaults to 7200 (2h)." })),
});

export const TaskUpdateParams = Type.Object({
  task_id: Type.String(),
  title: Type.Optional(Type.String()),
  description: OptionalNullableString,
  notes: TaskNotes,
  status: Type.Optional(TaskStatus),
  assigned_to_agent_id: TaskUpdateAssignedToAgentId,
  outcome: TaskOutcome,
});

export const TaskReorderParams = Type.Object({
  list_id: Type.String(),
  task_ids: Type.Array(Type.String(), { description: "Task ids in desired leading order. Other active tasks keep relative order after them." }),
});

export const TaskReleaseExpiredClaimsParams = Type.Object({
  list_id: Type.Optional(Type.String()),
});

export const TaskDeleteParams = Type.Object({
  task_id: Type.String(),
});
