import { z } from "zod/v4";
import { SCOPE_TYPES, TASK_STATUSES, VISIBILITIES } from "../core/types.js";

const ScopeType = z.enum(SCOPE_TYPES);
const Visibility = z.enum(VISIBILITIES);
const TaskStatus = z.enum(TASK_STATUSES);
const OptionalNullableString = z.string().nullable().optional();

export const taskListCreateSchema = z.object({
  id: z.string().optional().describe("Optional stable list id. Generated when omitted."),
  name: z.string().min(1).describe("Human-readable task list name."),
  scope_type: ScopeType,
  scope_key: z.string().min(1).describe("Workspace path, thread id, agent id, or custom key."),
  visibility: Visibility.optional(),
  owner_agent_id: OptionalNullableString,
});

export const taskListsFindSchema = z.object({
  scope_type: ScopeType.optional(),
  scope_key: z.string().optional(),
  visibility: Visibility.optional(),
  owner_agent_id: OptionalNullableString,
  created_by_agent_id: z.string().optional(),
  name: z.string().optional().describe("Case-insensitive substring match."),
  include_deleted: z.boolean().optional(),
  include_inaccessible_private: z
    .boolean()
    .optional()
    .describe("Requires explicit user confirmation before private lists owned by others are returned."),
});

export const taskListGetSchema = z.object({
  list_id: z.string(),
  statuses: z.array(TaskStatus).optional(),
  include_deleted: z.boolean().optional(),
});

export const taskCreateSchema = z.object({
  id: z.string().optional(),
  list_id: z.string(),
  title: z.string().min(1),
  description: OptionalNullableString,
  notes: OptionalNullableString,
  position: z.number().optional().describe("1-based desired position. Existing tasks are shifted down."),
  assigned_to_agent_id: OptionalNullableString,
});

export const taskAddManySchema = z.object({
  list_id: z.string(),
  tasks: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      description: OptionalNullableString,
      notes: OptionalNullableString,
      assigned_to_agent_id: OptionalNullableString,
    }),
  ),
});

export const taskClaimNextSchema = z.object({
  list_id: z.string(),
  claim_ttl_seconds: z.number().optional().describe("Claim TTL in seconds. Defaults to 7200 (2h)."),
  release_expired_first: z.boolean().optional().describe("Defaults to true."),
});

export const taskClaimRefreshSchema = z.object({
  task_id: z.string(),
  claim_ttl_seconds: z.number().optional().describe("New TTL from now in seconds. Defaults to 7200 (2h)."),
});

export const taskUpdateSchema = z.object({
  task_id: z.string(),
  title: z.string().optional(),
  description: OptionalNullableString,
  notes: OptionalNullableString,
  status: TaskStatus.optional(),
  assigned_to_agent_id: OptionalNullableString,
  result: OptionalNullableString,
});

export const taskReorderSchema = z.object({
  list_id: z.string(),
  task_ids: z.array(z.string()).describe("Task ids in desired leading order. Other active tasks keep relative order after them."),
});

export const taskReleaseExpiredClaimsSchema = z.object({
  list_id: z.string().optional(),
});

export const taskDeleteSchema = z.object({
  task_id: z.string(),
});
